/**
 * Model Router - Intelligent routing of content chunks to optimal AI models
 * Routes image-heavy content to GPT-5, text-only content to GPT-4o
 */

import { ContentChunk, ImageInfo } from './contentChunker';
import { rateLimiter, estimateTokenCount } from './rateLimiter';

export interface ModelSelection {
  model: 'gpt-5' | 'gpt-4o' | 'gpt-4-turbo' | 'gpt-4';
  reasoning: string;
  estimatedTokens: number;
  canProcess: boolean;
  waitTime: number;
}

export interface RoutingStrategy {
  name: string;
  description: string;
  gpt5Budget: number;    // tokens per minute allocated to GPT-5
  gpt4oBudget: number;   // tokens per minute allocated to GPT-4o
  bufferTokens: number;  // safety buffer
}

export interface RoutingMetrics {
  totalChunks: number;
  gpt5Chunks: number;
  gpt4oChunks: number;
  criticalImagesPreserved: number;
  totalImagesPreserved: number;
  estimatedProcessingTime: number; // minutes
  budgetUtilization: {
    gpt5Used: number;
    gpt4oUsed: number;
    totalBudget: number;
  };
}

/**
 * Smart model router that preserves images while optimizing for rate limits
 */
export class ModelRouter {
  private strategy: RoutingStrategy;
  
  constructor(strategy?: RoutingStrategy) {
    this.strategy = strategy || ModelRouter.getDefaultStrategy();
  }

  /**
   * Get default routing strategy optimized for image preservation
   */
  static getDefaultStrategy(): RoutingStrategy {
    return {
      name: 'Image-Preserving Hybrid',
      description: 'GPT-5 for critical images, GPT-4o for text content',
      gpt5Budget: 20000,   // 20K of 30K tokens/min for critical content
      gpt4oBudget: 10000,  // 10K tokens/min for secondary content  
      bufferTokens: 3000   // 3K token safety buffer
    };
  }

  /**
   * Route a single content chunk to the optimal model
   */
  routeContentChunk(chunk: ContentChunk): ModelSelection {
    const routing = this.analyzeChunkForRouting(chunk);
    const model = this.selectOptimalModel(routing);
    const canProcess = rateLimiter.canProcess(chunk.estimatedTokens, model);
    const waitTime = canProcess ? 0 : rateLimiter.waitTimeForTokens(chunk.estimatedTokens, model);

    return {
      model,
      reasoning: this.buildRoutingReasoning(chunk, routing, model),
      estimatedTokens: chunk.estimatedTokens,
      canProcess,
      waitTime
    };
  }

  /**
   * Route multiple chunks optimally across models
   */
  routeMultipleChunks(chunks: ContentChunk[]): Map<ContentChunk, ModelSelection> {
    const routingMap = new Map<ContentChunk, ModelSelection>();
    let gpt5TokensUsed = 0;
    let gpt4oTokensUsed = 0;

    // Sort chunks by priority (critical images first)
    const sortedChunks = [...chunks].sort((a, b) => {
      const aPriority = this.getNumericPriority(a);
      const bPriority = this.getNumericPriority(b);
      return aPriority - bPriority;
    });

    for (const chunk of sortedChunks) {
      const routing = this.analyzeChunkForRouting(chunk);
      let selectedModel: 'gpt-5' | 'gpt-4o' | 'gpt-4-turbo' | 'gpt-4';

      // Check if chunk has critical images
      if (routing.hasCriticalImages || routing.hasProductImages) {
        // Must use GPT-5 for image preservation
        if (gpt5TokensUsed + chunk.estimatedTokens <= this.strategy.gpt5Budget) {
          selectedModel = 'gpt-5';
          gpt5TokensUsed += chunk.estimatedTokens;
        } else {
          // GPT-5 budget exceeded, but images are critical
          // Use GPT-5 anyway and warn about budget
          selectedModel = 'gpt-5';
          gpt5TokensUsed += chunk.estimatedTokens;
        }
      } else if (routing.hasHeroImages && gpt5TokensUsed + chunk.estimatedTokens <= this.strategy.gpt5Budget) {
        // Use GPT-5 for hero images if budget allows
        selectedModel = 'gpt-5';
        gpt5TokensUsed += chunk.estimatedTokens;
      } else if (gpt4oTokensUsed + chunk.estimatedTokens <= this.strategy.gpt4oBudget) {
        // Use GPT-4o for text-heavy or decorative content
        selectedModel = 'gpt-4o';
        gpt4oTokensUsed += chunk.estimatedTokens;
      } else {
        // Both budgets tight, choose based on content importance
        if (routing.imageCount > 0) {
          selectedModel = 'gpt-5'; // Preserve any remaining images
          gpt5TokensUsed += chunk.estimatedTokens;
        } else {
          selectedModel = 'gpt-4o'; // Text-only content
          gpt4oTokensUsed += chunk.estimatedTokens;
        }
      }

      const canProcess = rateLimiter.canProcess(chunk.estimatedTokens, selectedModel);
      const waitTime = canProcess ? 0 : rateLimiter.waitTimeForTokens(chunk.estimatedTokens, selectedModel);

      routingMap.set(chunk, {
        model: selectedModel,
        reasoning: this.buildRoutingReasoning(chunk, routing, selectedModel),
        estimatedTokens: chunk.estimatedTokens,
        canProcess,
        waitTime
      });
    }

    return routingMap;
  }

  /**
   * Analyze routing metrics for a set of chunks
   */
  analyzeRoutingMetrics(chunks: ContentChunk[], routingMap: Map<ContentChunk, ModelSelection>): RoutingMetrics {
    let gpt5Chunks = 0;
    let gpt4oChunks = 0;
    let gpt5Tokens = 0;
    let gpt4oTokens = 0;
    let criticalImages = 0;
    let totalImages = 0;
    let maxWaitTime = 0;

    for (const [chunk, selection] of routingMap) {
      if (selection.model === 'gpt-5') {
        gpt5Chunks++;
        gpt5Tokens += selection.estimatedTokens;
      } else {
        gpt4oChunks++;
        gpt4oTokens += selection.estimatedTokens;
      }

      // Count preserved images
      criticalImages += chunk.images.filter(img => 
        img.importance === 'critical' || img.importance === 'product'
      ).length;
      totalImages += chunk.images.length;

      maxWaitTime = Math.max(maxWaitTime, selection.waitTime);
    }

    return {
      totalChunks: chunks.length,
      gpt5Chunks,
      gpt4oChunks,
      criticalImagesPreserved: criticalImages,
      totalImagesPreserved: totalImages,
      estimatedProcessingTime: Math.ceil(maxWaitTime / 60000), // Convert to minutes
      budgetUtilization: {
        gpt5Used: gpt5Tokens,
        gpt4oUsed: gpt4oTokens,
        totalBudget: this.strategy.gpt5Budget + this.strategy.gpt4oBudget
      }
    };
  }

  /**
   * Check if routing strategy can handle all chunks within rate limits
   */
  validateRoutingFeasibility(chunks: ContentChunk[]): {
    feasible: boolean;
    issues: string[];
    recommendations: string[];
  } {
    const issues: string[] = [];
    const recommendations: string[] = [];

    // Calculate total token requirements
    const totalTokens = chunks.reduce((sum, chunk) => sum + chunk.estimatedTokens, 0);
    const totalBudget = this.strategy.gpt5Budget + this.strategy.gpt4oBudget;

    if (totalTokens > totalBudget) {
      issues.push(`Total tokens (${totalTokens}) exceed available budget (${totalBudget})`);
      recommendations.push('Consider splitting request into multiple processing rounds');
    }

    // Check critical image requirements
    const criticalImageChunks = chunks.filter(chunk => 
      chunk.images.some(img => img.importance === 'critical' || img.importance === 'product')
    );
    const criticalTokens = criticalImageChunks.reduce((sum, chunk) => sum + chunk.estimatedTokens, 0);

    if (criticalTokens > this.strategy.gpt5Budget) {
      issues.push(`Critical image content (${criticalTokens} tokens) exceeds GPT-5 budget (${this.strategy.gpt5Budget})`);
      recommendations.push('Increase GPT-5 budget allocation or process in multiple rounds');
    }

    // Check individual chunk sizes
    const oversizedChunks = chunks.filter(chunk => chunk.estimatedTokens > 25000); // Conservative chunk limit
    if (oversizedChunks.length > 0) {
      issues.push(`${oversizedChunks.length} chunks exceed recommended size limit`);
      recommendations.push('Split oversized chunks into smaller sections');
    }

    return {
      feasible: issues.length === 0,
      issues,
      recommendations
    };
  }

  /**
   * Suggest optimal routing strategy based on content analysis
   */
  suggestOptimalStrategy(chunks: ContentChunk[]): RoutingStrategy {
    const totalTokens = chunks.reduce((sum, chunk) => sum + chunk.estimatedTokens, 0);
    const imageHeavyChunks = chunks.filter(chunk => chunk.images.length > 0);
    const criticalImageTokens = imageHeavyChunks
      .filter(chunk => chunk.images.some(img => img.importance === 'critical' || img.importance === 'product'))
      .reduce((sum, chunk) => sum + chunk.estimatedTokens, 0);

    // Adjust budget allocation based on content
    const imageRatio = imageHeavyChunks.length / chunks.length;
    
    let gpt5Budget: number;
    let gpt4oBudget: number;

    if (imageRatio > 0.7) {
      // Image-heavy site: allocate more to GPT-5
      gpt5Budget = 25000;
      gpt4oBudget = 5000;
    } else if (imageRatio < 0.3) {
      // Text-heavy site: allocate more to GPT-4o
      gpt5Budget = 15000;
      gpt4oBudget = 15000;
    } else {
      // Balanced site: use default allocation
      gpt5Budget = 20000;
      gpt4oBudget = 10000;
    }

    return {
      name: `Optimized for ${Math.round(imageRatio * 100)}% image content`,
      description: `Dynamically adjusted for content mix: ${chunks.length} chunks, ${imageHeavyChunks.length} with images`,
      gpt5Budget,
      gpt4oBudget,
      bufferTokens: 3000
    };
  }

  /**
   * Analyze individual chunk for routing decision
   */
  private analyzeChunkForRouting(chunk: ContentChunk): ChunkRoutingAnalysis {
    const imageAnalysis = {
      imageCount: chunk.images.length,
      hasCriticalImages: chunk.images.some(img => img.importance === 'critical'),
      hasProductImages: chunk.images.some(img => img.importance === 'product'),
      hasHeroImages: chunk.images.some(img => img.importance === 'hero'),
      imageTokenRatio: chunk.images.reduce((sum, img) => sum + img.estimatedTokens, 0) / chunk.estimatedTokens
    };

    const contentAnalysis = {
      isTextHeavy: imageAnalysis.imageTokenRatio < 0.3,
      isImageHeavy: imageAnalysis.imageTokenRatio > 0.7,
      chunkType: chunk.type,
      priority: chunk.priority
    };

    return { ...imageAnalysis, ...contentAnalysis };
  }

  /**
   * Select optimal model based on chunk analysis
   */
  private selectOptimalModel(analysis: ChunkRoutingAnalysis): 'gpt-5' | 'gpt-4o' | 'gpt-4-turbo' | 'gpt-4' {
    // Critical content always goes to GPT-5
    if (analysis.hasCriticalImages || analysis.hasProductImages) {
      return 'gpt-5';
    }

    // Hero images and high priority content prefer GPT-5
    if (analysis.hasHeroImages || analysis.priority === 'high') {
      return 'gpt-5';
    }

    // Image-heavy content benefits from GPT-5
    if (analysis.isImageHeavy && analysis.imageCount > 2) {
      return 'gpt-5';
    }

    // Text-heavy content can use GPT-4o effectively
    if (analysis.isTextHeavy || analysis.chunkType === 'footer' || analysis.chunkType === 'nav') {
      return 'gpt-4o';
    }

    // Default to GPT-4o for efficiency
    return 'gpt-4o';
  }

  /**
   * Build human-readable reasoning for model selection
   */
  private buildRoutingReasoning(chunk: ContentChunk, analysis: ChunkRoutingAnalysis, model: string): string {
    const reasons: string[] = [];

    if (analysis.hasCriticalImages) {
      reasons.push('contains critical images requiring preservation');
    }
    if (analysis.hasProductImages) {
      reasons.push('contains product images essential for functionality');
    }
    if (analysis.hasHeroImages) {
      reasons.push('contains hero/banner images');
    }
    if (analysis.isImageHeavy) {
      reasons.push(`image-heavy content (${Math.round(analysis.imageTokenRatio * 100)}% image tokens)`);
    }
    if (analysis.isTextHeavy) {
      reasons.push(`text-heavy content (${Math.round((1 - analysis.imageTokenRatio) * 100)}% text tokens)`);
    }
    if (chunk.priority === 'critical') {
      reasons.push('marked as critical priority');
    }

    const reasonText = reasons.length > 0 ? reasons.join(', ') : 'default routing';
    return `Using ${model} - ${reasonText}`;
  }

  /**
   * Convert priority to numeric value for sorting
   */
  private getNumericPriority(chunk: ContentChunk): number {
    const priorityValues = { critical: 0, high: 1, medium: 2, low: 3 };
    return priorityValues[chunk.priority];
  }

  /**
   * Update routing strategy
   */
  setStrategy(strategy: RoutingStrategy): void {
    this.strategy = strategy;
  }

  /**
   * Get current routing strategy
   */
  getStrategy(): RoutingStrategy {
    return { ...this.strategy };
  }
}

interface ChunkRoutingAnalysis {
  imageCount: number;
  hasCriticalImages: boolean;
  hasProductImages: boolean;
  hasHeroImages: boolean;
  imageTokenRatio: number;
  isTextHeavy: boolean;
  isImageHeavy: boolean;
  chunkType: ContentChunk['type'];
  priority: ContentChunk['priority'];
}

// Singleton instance for application use
export const modelRouter = new ModelRouter();

// Helper functions for routing decisions
export const RoutingUtils = {
  /**
   * Quick check if chunk needs GPT-5
   */
  requiresGPT5(chunk: ContentChunk): boolean {
    return chunk.images.some(img => 
      img.importance === 'critical' || img.importance === 'product'
    ) || chunk.priority === 'critical';
  },

  /**
   * Estimate processing time for chunks
   */
  estimateProcessingTime(chunks: ContentChunk[], routingMap: Map<ContentChunk, ModelSelection>): number {
    let maxTime = 0;
    
    for (const [, selection] of routingMap) {
      const processingTime = selection.waitTime + (selection.estimatedTokens / 100); // ~100 tokens per second
      maxTime = Math.max(maxTime, processingTime);
    }
    
    return Math.ceil(maxTime / 1000); // Return in seconds
  },

  /**
   * Calculate cost estimation (if needed for budgeting)
   */
  estimateCost(routingMap: Map<ContentChunk, ModelSelection>): { gpt5Cost: number; gpt4oCost: number; total: number } {
    let gpt5Tokens = 0;
    let gpt4oTokens = 0;

    for (const [, selection] of routingMap) {
      if (selection.model === 'gpt-5') {
        gpt5Tokens += selection.estimatedTokens;
      } else {
        gpt4oTokens += selection.estimatedTokens;
      }
    }

    // Approximate costs (these would need to be updated with current pricing)
    const gpt5Cost = (gpt5Tokens / 1000) * 0.03; // $0.03 per 1K tokens (placeholder)
    const gpt4oCost = (gpt4oTokens / 1000) * 0.005; // $0.005 per 1K tokens (placeholder)

    return {
      gpt5Cost,
      gpt4oCost, 
      total: gpt5Cost + gpt4oCost
    };
  }
};