/**
 * Streaming LLM Service
 * Processes content chunks sequentially with intelligent rate limiting and model routing
 */

import { ContentChunk, ChunkingResult } from '@/utils/contentChunker';
import { ModelSelection, modelRouter } from '@/utils/modelRouter';
import { rateLimiter, waitFor } from '@/utils/rateLimiter';
import { llmService } from './llmService';
import { RedesignRequest, RedesignResponse } from '@/types';

export interface ChunkResult {
  chunk: ContentChunk;
  result: Partial<RedesignResponse>;
  model: string;
  processingTime: number;
  tokensUsed: number;
  success: boolean;
  error?: string;
}

export interface StreamingProgress {
  currentChunk: number;
  totalChunks: number;
  completedChunks: number;
  failedChunks: number;
  currentModel: string;
  currentAction: string;
  estimatedTimeRemaining: number; // milliseconds
  tokensUsed: {
    gpt5: number;
    gpt4o: number;
    total: number;
  };
  imagePreservation: {
    totalImages: number;
    processedImages: number;
    preservedImages: number;
  };
}

export interface StreamingResult {
  success: boolean;
  result: RedesignResponse;
  chunks: ChunkResult[];
  metrics: {
    totalProcessingTime: number;
    averageChunkTime: number;
    tokensUsed: { gpt5: number; gpt4o: number; total: number };
    imagePreservation: { total: number; preserved: number; rate: number };
    modelUsage: { gpt5Chunks: number; gpt4oChunks: number };
    rateLimitingEvents: number;
  };
  errors: string[];
  warnings: string[];
}

export type ProgressCallback = (progress: StreamingProgress) => void;

/**
 * Streaming service for processing large websites in chunks
 */
export class StreamingLLMService {
  private static instance: StreamingLLMService;
  
  static getInstance(): StreamingLLMService {
    if (!StreamingLLMService.instance) {
      StreamingLLMService.instance = new StreamingLLMService();
    }
    return StreamingLLMService.instance;
  }

  /**
   * Process website redesign using chunked streaming approach
   */
  async processChunkedRedesign(
    request: RedesignRequest,
    chunkingResult: ChunkingResult,
    onProgress?: ProgressCallback
  ): Promise<StreamingResult> {
    const startTime = Date.now();
    const chunks = chunkingResult.chunks;
    const chunkResults: ChunkResult[] = [];
    const errors: string[] = [];
    const warnings: string[] = [];
    
    // Route chunks to optimal models
    const routingMap = modelRouter.routeMultipleChunks(chunks);
    const routingMetrics = modelRouter.analyzeRoutingMetrics(chunks, routingMap);
    
    console.log(`Processing ${chunks.length} chunks with routing:`, {
      gpt5Chunks: routingMetrics.gpt5Chunks,
      gpt4oChunks: routingMetrics.gpt4oChunks,
      criticalImages: routingMetrics.criticalImagesPreserved,
      totalImages: routingMetrics.totalImagesPreserved
    });
    
    const tokensUsed = { gpt5: 0, gpt4o: 0, total: 0 };
    let rateLimitingEvents = 0;
    let totalImages = 0;
    let preservedImages = 0;
    
    // Count total images for progress tracking
    for (const chunk of chunks) {
      totalImages += chunk.images.length;
    }
    
    // Process chunks sequentially in priority order
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const routing = routingMap.get(chunk);
      
      if (!routing) {
        errors.push(`No routing found for chunk ${chunk.id}`);
        continue;
      }
      
      // Update progress
      if (onProgress) {
        const progress: StreamingProgress = {
          currentChunk: i + 1,
          totalChunks: chunks.length,
          completedChunks: chunkResults.filter(r => r.success).length,
          failedChunks: chunkResults.filter(r => !r.success).length,
          currentModel: routing.model,
          currentAction: `Processing ${chunk.type} section with ${routing.model}`,
          estimatedTimeRemaining: this.estimateRemainingTime(chunks, i, chunkResults),
          tokensUsed,
          imagePreservation: {
            totalImages,
            processedImages: preservedImages,
            preservedImages
          }
        };
        onProgress(progress);
      }
      
      try {
        // Check rate limits and wait if necessary
        if (!rateLimiter.canProcess(chunk.estimatedTokens, routing.model)) {
          const waitTime = rateLimiter.waitTimeForTokens(chunk.estimatedTokens, routing.model);
          if (waitTime > 0) {
            console.log(`Rate limited, waiting ${waitTime}ms for ${routing.model}`);
            rateLimitingEvents++;
            
            if (onProgress) {
              const waitProgress: StreamingProgress = {
                currentChunk: i + 1,
                totalChunks: chunks.length,
                completedChunks: chunkResults.filter(r => r.success).length,
                failedChunks: chunkResults.filter(r => !r.success).length,
                currentModel: routing.model,
                currentAction: `Rate limited, waiting ${Math.ceil(waitTime / 1000)}s...`,
                estimatedTimeRemaining: waitTime + this.estimateRemainingTime(chunks, i, chunkResults),
                tokensUsed,
                imagePreservation: {
                  totalImages,
                  processedImages: preservedImages,
                  preservedImages
                }
              };
              onProgress(waitProgress);
            }
            
            await waitFor(waitTime);
          }
        }
        
        // Process the chunk
        const chunkResult = await this.processChunk(chunk, routing, request);
        chunkResults.push(chunkResult);
        
        // Update metrics
        if (chunkResult.success) {
          if (routing.model === 'gpt-5') {
            tokensUsed.gpt5 += chunkResult.tokensUsed;
          } else {
            tokensUsed.gpt4o += chunkResult.tokensUsed;
          }
          tokensUsed.total += chunkResult.tokensUsed;
          
          // Track image preservation
          preservedImages += chunk.images.length;
          
          // Consume tokens from rate limiter
          rateLimiter.consumeTokens(chunkResult.tokensUsed, routing.model);
        } else {
          errors.push(`Failed to process chunk ${chunk.id}: ${chunkResult.error}`);
        }
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`Error processing chunk ${chunk.id}: ${errorMessage}`);
        
        chunkResults.push({
          chunk,
          result: {},
          model: routing.model,
          processingTime: 0,
          tokensUsed: 0,
          success: false,
          error: errorMessage
        });
        
        // Record rate limiting errors
        if (errorMessage.includes('429') || errorMessage.includes('rate limit')) {
          rateLimiter.recordRateLimitError(routing.model);
          rateLimitingEvents++;
        }
      }
      
      // Small delay between chunks to be respectful
      if (i < chunks.length - 1) {
        await waitFor(100);
      }
    }
    
    // Aggregate results
    const aggregatedResult = this.aggregateChunkResults(chunkResults, chunkingResult);
    const totalTime = Date.now() - startTime;
    
    // Final progress update
    if (onProgress) {
      const finalProgress: StreamingProgress = {
        currentChunk: chunks.length,
        totalChunks: chunks.length,
        completedChunks: chunkResults.filter(r => r.success).length,
        failedChunks: chunkResults.filter(r => !r.success).length,
        currentModel: '',
        currentAction: 'Aggregating results...',
        estimatedTimeRemaining: 0,
        tokensUsed,
        imagePreservation: {
          totalImages,
          processedImages: preservedImages,
          preservedImages
        }
      };
      onProgress(finalProgress);
    }
    
    return {
      success: chunkResults.some(r => r.success),
      result: aggregatedResult,
      chunks: chunkResults,
      metrics: {
        totalProcessingTime: totalTime,
        averageChunkTime: chunkResults.length > 0 ? totalTime / chunkResults.length : 0,
        tokensUsed,
        imagePreservation: {
          total: totalImages,
          preserved: preservedImages,
          rate: totalImages > 0 ? preservedImages / totalImages : 1
        },
        modelUsage: {
          gpt5Chunks: chunkResults.filter(r => r.model === 'gpt-5').length,
          gpt4oChunks: chunkResults.filter(r => r.model !== 'gpt-5').length
        },
        rateLimitingEvents
      },
      errors,
      warnings
    };
  }
  
  /**
   * Process a single chunk with specified model
   */
  private async processChunk(
    chunk: ContentChunk,
    routing: ModelSelection,
    originalRequest: RedesignRequest
  ): Promise<ChunkResult> {
    const startTime = Date.now();
    
    try {
      // Build chunk-specific request
      const chunkRequest: RedesignRequest = {
        ...originalRequest,
        originalWebsite: {
          ...originalRequest.originalWebsite,
          html: chunk.html,
          css: chunk.css,
          javascript: chunk.javascript,
          images: chunk.images.map(img => img.src)
        }
      };
      
      // Add chunk context to user instructions
      const contextualInstructions = `${originalRequest.userInstructions}

CONTEXT: This is a ${chunk.type} section from a larger website. Maintain consistency with the overall design while focusing on this specific section. PRESERVE ALL IMAGES - they are critical to the website's functionality.`;
      
      chunkRequest.userInstructions = contextualInstructions;
      
      // Process with appropriate model
      let result: RedesignResponse;
      if (routing.model === 'gpt-5') {
        result = await llmService.generateRedesign(chunkRequest);
      } else {
        // For GPT-4o, we need to use chat completions directly
        result = await this.processWithGPT4o(chunkRequest);
      }
      
      const processingTime = Date.now() - startTime;
      const tokensUsed = routing.estimatedTokens; // Actual usage would be from API response
      
      return {
        chunk,
        result,
        model: routing.model,
        processingTime,
        tokensUsed,
        success: true
      };
      
    } catch (error) {
      const processingTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      return {
        chunk,
        result: {},
        model: routing.model,
        processingTime,
        tokensUsed: 0,
        success: false,
        error: errorMessage
      };
    }
  }
  
  /**
   * Process chunk with GPT-4o (fallback model)
   */
  private async processWithGPT4o(request: RedesignRequest): Promise<RedesignResponse> {
    // Use the existing LLM service but override the model
    // This is a simplified approach - in practice, you might want a separate service
    const originalModel = process.env.LLM_MODEL;
    process.env.LLM_MODEL = 'gpt-4o';
    
    try {
      const result = await llmService.generateRedesign(request);
      return result;
    } finally {
      // Restore original model
      if (originalModel) {
        process.env.LLM_MODEL = originalModel;
      }
    }
  }
  
  /**
   * Aggregate chunk results into final redesign
   */
  private aggregateChunkResults(
    chunkResults: ChunkResult[],
    chunkingResult: ChunkingResult
  ): RedesignResponse {
    const successfulResults = chunkResults.filter(r => r.success);
    
    if (successfulResults.length === 0) {
      throw new Error('No chunks were processed successfully');
    }
    
    // Combine HTML from all chunks in order
    const htmlParts: string[] = [];
    const cssParts: string[] = [];
    const jsParts: string[] = [];
    const improvements: string[] = [];
    const rationales: string[] = [];
    
    // Sort by chunk type priority for proper HTML structure
    const sortedResults = successfulResults.sort((a, b) => {
      const typeOrder = ['header', 'nav', 'hero', 'main', 'product', 'gallery', 'aside', 'footer', 'mixed'];
      return typeOrder.indexOf(a.chunk.type) - typeOrder.indexOf(b.chunk.type);
    });
    
    for (const chunkResult of sortedResults) {
      if (chunkResult.result.html) {
        htmlParts.push(chunkResult.result.html);
      }
      if (chunkResult.result.css) {
        cssParts.push(`/* ${chunkResult.chunk.type} section styles */`);
        cssParts.push(chunkResult.result.css);
      }
      if (chunkResult.result.javascript) {
        jsParts.push(`// ${chunkResult.chunk.type} section scripts`);
        jsParts.push(chunkResult.result.javascript);
      }
      if (chunkResult.result.improvements) {
        improvements.push(...chunkResult.result.improvements);
      }
      if (chunkResult.result.designRationale) {
        rationales.push(`${chunkResult.chunk.type}: ${chunkResult.result.designRationale}`);
      }
    }
    
    // Wrap HTML in proper document structure
    const completeHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Redesigned Website</title>
</head>
<body>
${htmlParts.join('\n')}
</body>
</html>`;
    
    const completeCss = cssParts.join('\n\n');
    const completeJs = jsParts.join('\n\n');
    
    // Aggregate assets
    const allAssets = {
      images: successfulResults.flatMap(r => r.result.assets?.images || []),
      fonts: successfulResults.flatMap(r => r.result.assets?.fonts || [])
    };
    
    return {
      html: completeHtml,
      css: completeCss,
      javascript: completeJs,
      assets: allAssets,
      designRationale: `Chunked processing results:\n${rationales.join('\n')}\n\nThis design was created by processing ${successfulResults.length} content sections individually to preserve all images while respecting rate limits.`,
      improvements: [
        ...improvements,
        `Processed ${successfulResults.length} sections individually`,
        `Preserved ${chunkingResult.imageAnalysis.count} images through chunked processing`,
        'Optimized for rate limits while maintaining design coherence'
      ]
    };
  }
  
  /**
   * Estimate remaining processing time
   */
  private estimateRemainingTime(
    chunks: ContentChunk[],
    currentIndex: number,
    completedResults: ChunkResult[]
  ): number {
    if (completedResults.length === 0) {
      return chunks.length * 10000; // Rough estimate: 10 seconds per chunk
    }
    
    const avgTimePerChunk = completedResults.reduce((sum, r) => sum + r.processingTime, 0) / completedResults.length;
    const remainingChunks = chunks.length - currentIndex;
    
    return Math.round(avgTimePerChunk * remainingChunks);
  }
  
  /**
   * Quick validation that chunked approach is worth it
   */
  static shouldUseChunkedProcessing(
    websiteData: { html: string; css: string; javascript: string },
    estimatedTokens: number
  ): boolean {
    // Use chunked processing if:
    // 1. Content is large (>100KB)
    // 2. Estimated tokens exceed 25K (safe margin under 30K limit)
    // 3. Content has many images
    
    const totalSize = websiteData.html.length + websiteData.css.length + websiteData.javascript.length;
    const imageCount = (websiteData.html.match(/<img[^>]*>/g) || []).length;
    
    return totalSize > 100000 || estimatedTokens > 25000 || imageCount > 10;
  }
}

// Export singleton instance
export const streamingLlmService = StreamingLLMService.getInstance();