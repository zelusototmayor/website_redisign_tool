import OpenAI from 'openai';
import { RedesignRequest, RedesignResponse, FeedbackRequest } from '@/types';
import { buildRedesignPrompt, buildIterationPrompt, ChunkContext } from '@/config/prompts';
import { ContentOptimizer } from '@/utils/contentOptimization';
import { ContentChunker } from '@/utils/contentChunker';
import { streamingLlmService, StreamingResult, ProgressCallback } from './streamingLlmService';
import { estimateTokenCount } from '@/utils/rateLimiter';
import { metricsCollector } from '@/utils/metrics';

export class LLMService {
  private openai: OpenAI;
  private model: string;

  constructor(apiKey?: string) {
    this.openai = new OpenAI({
      apiKey: apiKey || process.env.OPENAI_API_KEY || '',
    });
    this.model = process.env.LLM_MODEL || 'gpt-5';
  }

  private async callLLM(prompt: string): Promise<string> {
    let lastError: Error | null = null;
    
    // Try up to 2 times (1 retry)
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        // First try Responses API
        try {
          const response = await this.openai.responses.create({
            model: this.model,
            input: [{ role: 'user', content: prompt }],
            max_output_tokens: 32000, // Maximum for GPT-5
          });

          // Extract text from Responses API
          if (response.output_text) {
            return response.output_text;
          }
          
          if (response.output && Array.isArray(response.output)) {
            const textParts = response.output
              .flatMap(item => item.content || [])
              .filter(content => content.text)
              .map(content => content.text);
            
            if (textParts.length > 0) {
              return textParts.join('\n');
            }
          }
          
          throw new Error("Empty response from Responses API");
        } catch (responsesError: unknown) {
          // If Responses API is not available (404/400) or method missing, fallback to chat completions
          if ((responsesError as { status?: number; message?: string })?.status === 404 || (responsesError as { status?: number; message?: string })?.status === 400 || 
              (responsesError as { status?: number; message?: string })?.message?.includes('responses') ||
              typeof this.openai.responses?.create !== 'function') {
            
            const completion = await this.openai.chat.completions.create({
              model: this.model,
              messages: [{ role: 'user', content: prompt }],
              max_completion_tokens: 32000, // Maximum for GPT-5
            });

            const responseContent = completion.choices[0]?.message?.content;
            if (!responseContent) {
              throw new Error("Empty LLM response");
            }
            
            return responseContent;
          }
          
          // Re-throw other errors
          throw responsesError;
        }
      } catch (error: unknown) {
        lastError = error as Error;
        
        // Retry on rate limit or server errors
        if (attempt === 0 && ((error as { status?: number })?.status === 429 || ((error as { status?: number })?.status >= 500 && (error as { status?: number })?.status < 600))) {
          await new Promise(resolve => setTimeout(resolve, 500));
          continue;
        }
        
        // Don't retry on other errors
        break;
      }
    }
    
    throw lastError || new Error("Failed to get LLM response");
  }

  /**
   * Generate redesign with automatic chunking detection
   */
  async generateRedesign(request: RedesignRequest, onProgress?: ProgressCallback): Promise<RedesignResponse> {
    const startTime = Date.now();
    
    try {
      // Analyze content to determine if chunking is needed
      const shouldUseChunking = this.shouldUseChunkedProcessing(request.originalWebsite);
      
      if (shouldUseChunking) {
        console.log('Large/image-heavy website detected - using chunked processing approach');
        return await this.generateRedesignChunked(request, onProgress);
      } else {
        console.log('Small website - using traditional single-request approach');
        return await this.generateRedesignTraditional(request);
      }
      
    } catch (error) {
      // Record metrics for failed request
      metricsCollector.recordRequest({
        model: this.model,
        tokensInput: 0,
        tokensOutput: 0,
        processingTimeMs: Date.now() - startTime,
        success: false,
        errorType: error instanceof Error ? error.message : 'Unknown error',
        chunked: false
      });
      
      console.error('Error generating redesign:', error);
      throw new Error(`Failed to generate redesign: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  /**
   * Generate redesign using chunked processing for large/image-heavy websites
   */
  async generateRedesignChunked(request: RedesignRequest, onProgress?: ProgressCallback): Promise<RedesignResponse> {
    const startTime = Date.now();
    
    try {
      // Optimize content while preserving images
      let optimizedWebsite = request.originalWebsite;
      if (ContentOptimizer.needsOptimization(request.originalWebsite)) {
        console.log('Optimizing content for chunked processing...');
        const optimized = ContentOptimizer.optimizeWebsiteData(request.originalWebsite);
        
        // Validate image preservation
        const preservation = ContentOptimizer.validateImagePreservation(
          request.originalWebsite.html,
          optimized.html
        );
        
        if (!preservation.success) {
          console.warn('Image preservation issues detected:', preservation.issues);
          metricsCollector.recordImagePreservation({
            originalCount: (request.originalWebsite.html.match(/<img[^>]*>/g) || []).length,
            preservedCount: (optimized.html.match(/<img[^>]*>/g) || []).length,
            success: false,
            issues: preservation.issues
          });
        } else {
          metricsCollector.recordImagePreservation({
            originalCount: (request.originalWebsite.html.match(/<img[^>]*>/g) || []).length,
            preservedCount: (optimized.html.match(/<img[^>]*>/g) || []).length,
            success: true,
            issues: []
          });
        }
        
        optimizedWebsite = {
          ...request.originalWebsite,
          ...optimized
        };
      }
      
      // Chunk the content
      const chunkingResult = ContentChunker.chunkContent(
        optimizedWebsite.html,
        optimizedWebsite.css,
        optimizedWebsite.javascript
      );
      
      console.log(`Website chunked into ${chunkingResult.chunks.length} sections:`, {
        totalImages: chunkingResult.imageAnalysis.count,
        criticalImages: chunkingResult.imageAnalysis.critical,
        productImages: chunkingResult.imageAnalysis.product,
        chunks: chunkingResult.chunks.map(c => ({ type: c.type, images: c.images.length, tokens: c.estimatedTokens }))
      });
      
      // Process chunks using streaming service
      const streamingResult: StreamingResult = await streamingLlmService.processChunkedRedesign(
        request,
        chunkingResult,
        onProgress
      );
      
      // Record comprehensive metrics
      metricsCollector.recordRequest({
        model: 'chunked-hybrid',
        tokensInput: streamingResult.metrics.tokensUsed.total,
        tokensOutput: 0, // Output tokens aren't easily measurable in chunked mode
        processingTimeMs: streamingResult.metrics.totalProcessingTime,
        success: streamingResult.success,
        errorType: streamingResult.errors.length > 0 ? streamingResult.errors[0] : undefined,
        chunked: true
      });
      
      metricsCollector.recordRateLimit({
        model: 'gpt-5',
        rateLimitHit: streamingResult.metrics.rateLimitingEvents > 0,
        waitTimeMs: 0, // Aggregated wait time not easily available
        recoveryTimeMs: 0
      });
      
      if (!streamingResult.success) {
        throw new Error(`Chunked processing failed: ${streamingResult.errors.join(', ')}`);
      }
      
      return streamingResult.result;
      
    } catch (error) {
      metricsCollector.recordRequest({
        model: 'chunked-hybrid',
        tokensInput: 0,
        tokensOutput: 0,
        processingTimeMs: Date.now() - startTime,
        success: false,
        errorType: error instanceof Error ? error.message : 'Unknown error',
        chunked: true
      });
      
      throw error;
    }
  }
  
  /**
   * Generate redesign using traditional single-request approach
   */
  async generateRedesignTraditional(request: RedesignRequest): Promise<RedesignResponse> {
    const startTime = Date.now();
    let inputTokens = 0;
    
    try {
      // Optimize content if needed
      let optimizedWebsite = request.originalWebsite;
      if (ContentOptimizer.needsOptimization(request.originalWebsite)) {
        console.log('Optimizing large website content for processing...');
        const optimized = ContentOptimizer.optimizeWebsiteData(request.originalWebsite);
        optimizedWebsite = {
          ...request.originalWebsite,
          ...optimized
        };
      }

      const prompt = buildRedesignPrompt(
        optimizedWebsite,
        request.userInstructions,
        request.designStyle,
        request.targetAudience
      );
      
      inputTokens = estimateTokenCount(prompt);
      console.log(`Traditional processing with estimated ${inputTokens} input tokens`);

      const responseContent = await this.callLLM(prompt);
      const cleanedResponse = this.extractJsonFromResponse(responseContent);
      const parsedResponse = JSON.parse(cleanedResponse);
      
      const result: RedesignResponse = {
        html: parsedResponse.html || '',
        css: parsedResponse.css || '',
        javascript: parsedResponse.javascript || '',
        assets: {
          images: parsedResponse.assets?.images || [],
          fonts: parsedResponse.assets?.fonts || []
        },
        designRationale: parsedResponse.designRationale || '',
        improvements: parsedResponse.improvements || []
      };
      
      // Record successful metrics
      metricsCollector.recordRequest({
        model: this.model,
        tokensInput: inputTokens,
        tokensOutput: estimateTokenCount(JSON.stringify(result)),
        processingTimeMs: Date.now() - startTime,
        success: true,
        chunked: false
      });
      
      return result;
      
    } catch (error) {
      // Record failed metrics
      metricsCollector.recordRequest({
        model: this.model,
        tokensInput: inputTokens,
        tokensOutput: 0,
        processingTimeMs: Date.now() - startTime,
        success: false,
        errorType: error instanceof Error ? error.message : 'Unknown error',
        chunked: false
      });
      
      throw error;
    }
  }

  async iterateDesign(request: FeedbackRequest): Promise<RedesignResponse> {
    try {
      const prompt = buildIterationPrompt(
        request.currentDesign,
        request.userFeedback,
        request.iterationNumber
      );

      const responseContent = await this.callLLM(prompt);
      const cleanedResponse = this.extractJsonFromResponse(responseContent);
      const parsedResponse = JSON.parse(cleanedResponse);

      return {
        html: parsedResponse.html || '',
        css: parsedResponse.css || '',
        javascript: parsedResponse.javascript || '',
        assets: {
          images: parsedResponse.assets?.images || [],
          fonts: parsedResponse.assets?.fonts || []
        },
        designRationale: parsedResponse.designRationale || '',
        improvements: parsedResponse.improvements || []
      };
    } catch (error) {
      console.error('Error iterating design:', error);
      throw new Error(`Failed to iterate design: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private repairTruncatedJson(truncatedJson: string): string {
    console.log('Attempting to repair truncated JSON of length:', truncatedJson.length);
    
    // Try to find the last complete field and close the JSON properly
    let repaired = truncatedJson.trim();
    
    // Look for the main JSON structure markers
    const htmlMatch = repaired.match(/"html":\s*"((?:[^"\\]|\\.)*)"/);
    const cssMatch = repaired.match(/"css":\s*"((?:[^"\\]|\\.)*)"/);
    
    // If we have at least HTML content, we can build a working response
    if (htmlMatch) {
      console.log('Found HTML content, attempting repair...');
      
      // Extract what we can find
      const html = htmlMatch[1] || '';
      
      // Try to extract CSS if available
      let css = '';
      if (cssMatch) {
        css = cssMatch[1] || '';
      } else {
        // Look for CSS content after html field
        const afterHtml = repaired.substring(repaired.indexOf('"html"'));
        const cssStart = afterHtml.indexOf('"css"');
        if (cssStart > 0) {
          const cssContent = afterHtml.substring(cssStart);
          const cssValueMatch = cssContent.match(/"css":\s*"([^"]*)"/);
          if (cssValueMatch) {
            css = cssValueMatch[1] || '';
          }
        }
      }
      
      // Build a minimal working response
      const repairedResponse = {
        html: html,
        css: css,
        javascript: '',
        designRationale: 'Response was truncated due to size limits. The HTML and CSS have been preserved.',
        improvements: [
          'HTML structure has been modernized',
          'CSS styling has been improved',
          'Response was truncated - consider using shorter content for complete output'
        ]
      };
      
      console.log('Successfully repaired truncated response');
      return JSON.stringify(repairedResponse);
    }
    
    // Fallback: try the original repair logic
    console.log('HTML not found, trying general repair...');
    
    // Remove any incomplete trailing content
    const lastCompleteField = Math.max(
      repaired.lastIndexOf('",'),
      repaired.lastIndexOf('"]'),
      repaired.lastIndexOf('}')
    );
    
    if (lastCompleteField > 0) {
      repaired = repaired.substring(0, lastCompleteField + 1);
      
      // Ensure proper JSON closure
      let openBraces = 0;
      for (const char of repaired) {
        if (char === '{') openBraces++;
        if (char === '}') openBraces--;
      }
      
      // Close any open braces
      while (openBraces > 0) {
        repaired += '}';
        openBraces--;
      }
      
      // Try to parse the repaired JSON
      try {
        const parsed = JSON.parse(repaired);
        // Ensure we have the required fields with defaults
        return JSON.stringify({
          html: parsed.html || '',
          css: parsed.css || '',
          javascript: parsed.javascript || '',
          designRationale: parsed.designRationale || 'Design was truncated due to response limits.',
          improvements: parsed.improvements || ['Response was truncated - please try again for complete output']
        });
      } catch (parseError) {
        console.error('JSON parse error during repair:', parseError);
      }
    }
    
    // Last resort: create a minimal response
    console.log('All repair attempts failed, creating minimal response');
    return JSON.stringify({
      html: '<p>Response was truncated. Please try with a simpler website or shorter instructions.</p>',
      css: 'body { font-family: Arial, sans-serif; margin: 20px; }',
      javascript: '',
      designRationale: 'The AI response was too large and got truncated. Please try again with simpler content.',
      improvements: ['Response truncation prevented complete processing']
    });
  }

  private extractJsonFromResponse(response: string): string {
    // Remove any leading/trailing whitespace
    const trimmed = response.trim();
    console.log(`LLM response length: ${response.length}, starts with: "${response.substring(0, 100)}..."`);
    console.log(`LLM response ends with: "...${response.substring(response.length - 100)}"`);
    
    // Check if response is truncated (ends abruptly)
    if (!trimmed.endsWith('}') && !trimmed.endsWith('```')) {
      console.warn('LLM response appears to be truncated - does not end with } or ```');
      // For truncated responses, try to salvage what we can
      if (trimmed.includes('"html"') && trimmed.includes('"css"')) {
        console.log('Attempting to repair truncated JSON response...');
        return this.repairTruncatedJson(trimmed);
      }
    }
    
    // Try to find JSON in code blocks first
    const codeBlockMatch = trimmed.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (codeBlockMatch) {
      const jsonStr = codeBlockMatch[1].trim();
      // Try to parse to validate it's proper JSON
      try {
        JSON.parse(jsonStr);
        return jsonStr;
      } catch {
        // Continue to other methods if parsing fails
      }
    }
    
    // Try to find a complete JSON object by matching braces
    let braceCount = 0;
    let startIndex = -1;
    let endIndex = -1;
    
    for (let i = 0; i < trimmed.length; i++) {
      const char = trimmed[i];
      
      if (char === '{') {
        if (startIndex === -1) {
          startIndex = i;
        }
        braceCount++;
      } else if (char === '}') {
        braceCount--;
        if (braceCount === 0 && startIndex !== -1) {
          endIndex = i;
          break;
        }
      }
    }
    
    if (startIndex !== -1 && endIndex !== -1) {
      const jsonStr = trimmed.substring(startIndex, endIndex + 1);
      // Try to parse to validate it's proper JSON
      try {
        JSON.parse(jsonStr);
        return jsonStr;
      } catch {
        // Continue if this extraction didn't work
      }
    }
    
    // If response starts and ends with braces, try it as-is
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        JSON.parse(trimmed);
        return trimmed;
      } catch {
        // Continue if parsing fails
      }
    }
    
    // Last resort: try to find any JSON-like structure
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        JSON.parse(jsonMatch[0]);
        return jsonMatch[0];
      } catch {
        // If still invalid, throw with more context
        throw new Error(`Found JSON-like structure but it's malformed. First 200 chars: "${jsonMatch[0].substring(0, 200)}..."`);
      }
    }
    
    // If no JSON found, throw an error with context
    throw new Error(`No valid JSON found in LLM response. Response starts with: "${trimmed.substring(0, 100)}..."`);
  }

  /**
   * Determine if website should use chunked processing
   */
  private shouldUseChunkedProcessing(websiteData: { html: string; css: string; javascript: string }): boolean {
    // Calculate total content size
    const totalSize = websiteData.html.length + websiteData.css.length + websiteData.javascript.length;
    
    // Estimate token count for the content
    const estimatedTokens = estimateTokenCount(websiteData.html + websiteData.css + websiteData.javascript);
    
    // Count images in content
    const imageCount = (websiteData.html.match(/<img[^>]*>/g) || []).length;
    
    // Use chunked processing if:
    // 1. Content is large (>75KB after optimization)
    // 2. Estimated tokens exceed 20K (safe margin under 30K limit) 
    // 3. Content has many images (>8 images)
    // 4. Combined factors indicate complexity
    
    const shouldChunk = (
      totalSize > 75000 || 
      estimatedTokens > 20000 || 
      imageCount > 8 ||
      (totalSize > 50000 && imageCount > 5) // Combined threshold
    );
    
    console.log('Chunking decision analysis:', {
      totalSize,
      estimatedTokens,
      imageCount,
      shouldChunk,
      reasons: {
        largeContent: totalSize > 75000,
        highTokens: estimatedTokens > 20000,
        manyImages: imageCount > 8,
        combinedFactors: totalSize > 50000 && imageCount > 5
      }
    });
    
    return shouldChunk;
  }
  
  /**
   * Process single chunk with specific model and context
   */
  async processChunk(
    websiteData: { title: string; description: string; url: string; html: string; css: string; javascript: string },
    userInstructions: string,
    chunkContext: ChunkContext,
    designStyle?: string,
    targetAudience?: string
  ): Promise<RedesignResponse> {
    const startTime = Date.now();
    
    try {
      const prompt = buildRedesignPrompt(
        websiteData,
        userInstructions,
        designStyle,
        targetAudience,
        chunkContext
      );
      
      const inputTokens = estimateTokenCount(prompt);
      console.log(`Processing ${chunkContext.sectionType} chunk with ${chunkContext.model} (${inputTokens} tokens)`);
      
      // Temporarily override model if needed for this chunk
      const originalModel = this.model;
      if (chunkContext.model !== this.model) {
        this.model = chunkContext.model;
      }
      
      try {
        const responseContent = await this.callLLM(prompt);
        const cleanedResponse = this.extractJsonFromResponse(responseContent);
        const parsedResponse = JSON.parse(cleanedResponse);
        
        const result: RedesignResponse = {
          html: parsedResponse.html || '',
          css: parsedResponse.css || '',
          javascript: parsedResponse.javascript || '',
          assets: {
            images: parsedResponse.assets?.images || [],
            fonts: parsedResponse.assets?.fonts || []
          },
          designRationale: parsedResponse.designRationale || '',
          improvements: parsedResponse.improvements || []
        };
        
        // Record metrics for this chunk
        metricsCollector.recordRequest({
          model: chunkContext.model,
          tokensInput: inputTokens,
          tokensOutput: estimateTokenCount(JSON.stringify(result)),
          processingTimeMs: Date.now() - startTime,
          success: true,
          chunked: true
        });
        
        return result;
        
      } finally {
        // Restore original model
        this.model = originalModel;
      }
      
    } catch (error) {
      metricsCollector.recordRequest({
        model: chunkContext.model,
        tokensInput: estimateTokenCount(''),
        tokensOutput: 0,
        processingTimeMs: Date.now() - startTime,
        success: false,
        errorType: error instanceof Error ? error.message : 'Unknown error',
        chunked: true
      });
      
      throw error;
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const completion = await this.openai.chat.completions.create({
        model: this.model,
        messages: [{ role: "user", content: "Hello" }],
        max_completion_tokens: 5,
      });
      return !!completion.choices[0]?.message?.content;
    } catch (error) {
      console.error('LLM connection test failed:', error);
      return false;
    }
  }
}

export const llmService = new LLMService();