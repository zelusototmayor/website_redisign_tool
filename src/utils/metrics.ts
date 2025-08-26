/**
 * Comprehensive Metrics Collection Service
 * Tracks performance, rate limits, image preservation, and processing metrics
 */

export interface RequestMetrics {
  timestamp: number;
  model: 'gpt-5' | 'gpt-4o' | 'gpt-4-turbo' | 'gpt-4';
  tokensRequested: number;
  tokensUsed: number;
  processingTime: number; // milliseconds
  success: boolean;
  error?: string;
  chunkId?: string;
  chunkType?: string;
}

export interface RateLimitMetrics {
  timestamp: number;
  model: string;
  tokensRequested: number;
  waitTime: number; // milliseconds
  reason: '429_error' | 'proactive_limiting' | 'queue_full';
}

export interface ImagePreservationMetrics {
  timestamp: number;
  originalImageCount: number;
  preservedImageCount: number;
  lostImages: string[]; // URLs/sources of lost images
  criticalImagesLost: number;
  productImagesLost: number;
  preservationRate: number;
  chunkId?: string;
}

export interface ProcessingMetrics {
  timestamp: number;
  websiteUrl: string;
  processingType: 'single_request' | 'chunked_processing';
  totalChunks?: number;
  
  // Timing
  totalProcessingTime: number;
  extractionTime: number;
  chunkingTime: number;
  llmProcessingTime: number;
  aggregationTime: number;
  
  // Content metrics
  originalContentSize: number; // bytes
  optimizedContentSize: number;
  compressionRatio: number;
  
  // Model usage
  gpt5TokensUsed: number;
  gpt4oTokensUsed: number;
  totalTokensUsed: number;
  
  // Success metrics
  chunksProcessed: number;
  chunksSuccessful: number;
  chunksFailed: number;
  
  // Rate limiting
  rateLimitEvents: number;
  totalWaitTime: number;
  
  success: boolean;
  finalError?: string;
}

export interface QualityMetrics {
  timestamp: number;
  
  // Design coherence (subjective, can be enhanced later)
  designCoherenceScore: number; // 0-1
  
  // Image quality
  imagePreservationRate: number;
  criticalImagePreservationRate: number;
  
  // Content quality  
  contentCompletenessScore: number; // 0-1 based on preserved sections
  
  // User satisfaction (if feedback provided)
  userRating?: number; // 1-5
  userFeedback?: string;
}

export interface MetricsSummary {
  timeRange: {
    start: number;
    end: number;
  };
  
  // Request statistics
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  successRate: number;
  
  // Processing performance
  averageProcessingTime: number;
  medianProcessingTime: number;
  totalProcessingTime: number;
  
  // Token usage
  totalTokensUsed: number;
  tokensByModel: {
    'gpt-5': number;
    'gpt-4o': number;
    'gpt-4-turbo': number;
    'gpt-4': number;
  };
  averageTokensPerRequest: number;
  
  // Rate limiting
  totalRateLimitEvents: number;
  totalWaitTime: number;
  averageWaitTime: number;
  
  // Image preservation
  totalImagesProcessed: number;
  totalImagesPreserved: number;
  overallPreservationRate: number;
  criticalImagesLost: number;
  
  // Content optimization
  averageCompressionRatio: number;
  totalBytesSaved: number;
  
  // Processing method effectiveness
  singleRequestSuccess: number;
  chunkedProcessingSuccess: number;
  
  // Quality scores
  averageDesignCoherence: number;
  averageContentCompleteness: number;
  averageUserRating: number;
}

/**
 * Metrics collector and analyzer
 */
export class MetricsCollector {
  private static instance: MetricsCollector;
  
  private requestMetrics: RequestMetrics[] = [];
  private rateLimitMetrics: RateLimitMetrics[] = [];
  private imageMetrics: ImagePreservationMetrics[] = [];
  private processingMetrics: ProcessingMetrics[] = [];
  private qualityMetrics: QualityMetrics[] = [];
  
  // In-memory storage limits (in production, you'd use a proper database)
  private readonly MAX_METRICS_STORED = 1000;
  
  static getInstance(): MetricsCollector {
    if (!MetricsCollector.instance) {
      MetricsCollector.instance = new MetricsCollector();
    }
    return MetricsCollector.instance;
  }
  
  /**
   * Record API request metrics
   */
  recordRequest(metrics: Omit<RequestMetrics, 'timestamp'>): void {
    this.requestMetrics.push({
      ...metrics,
      timestamp: Date.now()
    });
    this.trimMetrics(this.requestMetrics);
  }
  
  /**
   * Record rate limiting event
   */
  recordRateLimit(metrics: Omit<RateLimitMetrics, 'timestamp'>): void {
    this.rateLimitMetrics.push({
      ...metrics,
      timestamp: Date.now()
    });
    this.trimMetrics(this.rateLimitMetrics);
  }
  
  /**
   * Record image preservation metrics
   */
  recordImagePreservation(metrics: Omit<ImagePreservationMetrics, 'timestamp' | 'preservationRate'>): void {
    const preservationRate = metrics.originalImageCount > 0 
      ? metrics.preservedImageCount / metrics.originalImageCount 
      : 1;
      
    this.imageMetrics.push({
      ...metrics,
      preservationRate,
      timestamp: Date.now()
    });
    this.trimMetrics(this.imageMetrics);
  }
  
  /**
   * Record overall processing metrics
   */
  recordProcessing(metrics: Omit<ProcessingMetrics, 'timestamp' | 'compressionRatio'>): void {
    const compressionRatio = metrics.originalContentSize > 0 
      ? metrics.optimizedContentSize / metrics.originalContentSize 
      : 1;
      
    this.processingMetrics.push({
      ...metrics,
      compressionRatio,
      timestamp: Date.now()
    });
    this.trimMetrics(this.processingMetrics);
  }
  
  /**
   * Record quality metrics
   */
  recordQuality(metrics: Omit<QualityMetrics, 'timestamp'>): void {
    this.qualityMetrics.push({
      ...metrics,
      timestamp: Date.now()
    });
    this.trimMetrics(this.qualityMetrics);
  }
  
  /**
   * Get comprehensive metrics summary
   */
  getSummary(timeRangeMs: number = 24 * 60 * 60 * 1000): MetricsSummary {
    const now = Date.now();
    const start = now - timeRangeMs;
    
    // Filter metrics by time range
    const recentRequests = this.requestMetrics.filter(m => m.timestamp >= start);
    const recentRateLimits = this.rateLimitMetrics.filter(m => m.timestamp >= start);
    const recentImages = this.imageMetrics.filter(m => m.timestamp >= start);
    const recentProcessing = this.processingMetrics.filter(m => m.timestamp >= start);
    const recentQuality = this.qualityMetrics.filter(m => m.timestamp >= start);
    
    // Calculate request statistics
    const totalRequests = recentRequests.length;
    const successfulRequests = recentRequests.filter(r => r.success).length;
    const failedRequests = totalRequests - successfulRequests;
    const successRate = totalRequests > 0 ? successfulRequests / totalRequests : 0;
    
    // Calculate processing times
    const processingTimes = recentRequests.map(r => r.processingTime);
    const averageProcessingTime = this.calculateAverage(processingTimes);
    const medianProcessingTime = this.calculateMedian(processingTimes);
    const totalProcessingTime = processingTimes.reduce((sum, time) => sum + time, 0);
    
    // Calculate token usage
    const totalTokensUsed = recentRequests.reduce((sum, r) => sum + r.tokensUsed, 0);
    const tokensByModel = {
      'gpt-5': recentRequests.filter(r => r.model === 'gpt-5').reduce((sum, r) => sum + r.tokensUsed, 0),
      'gpt-4o': recentRequests.filter(r => r.model === 'gpt-4o').reduce((sum, r) => sum + r.tokensUsed, 0),
      'gpt-4-turbo': recentRequests.filter(r => r.model === 'gpt-4-turbo').reduce((sum, r) => sum + r.tokensUsed, 0),
      'gpt-4': recentRequests.filter(r => r.model === 'gpt-4').reduce((sum, r) => sum + r.tokensUsed, 0)
    };
    const averageTokensPerRequest = totalRequests > 0 ? totalTokensUsed / totalRequests : 0;
    
    // Calculate rate limiting
    const totalRateLimitEvents = recentRateLimits.length;
    const totalWaitTime = recentRateLimits.reduce((sum, r) => sum + r.waitTime, 0);
    const averageWaitTime = totalRateLimitEvents > 0 ? totalWaitTime / totalRateLimitEvents : 0;
    
    // Calculate image preservation
    const totalImagesProcessed = recentImages.reduce((sum, i) => sum + i.originalImageCount, 0);
    const totalImagesPreserved = recentImages.reduce((sum, i) => sum + i.preservedImageCount, 0);
    const overallPreservationRate = totalImagesProcessed > 0 ? totalImagesPreserved / totalImagesProcessed : 1;
    const criticalImagesLost = recentImages.reduce((sum, i) => sum + i.criticalImagesLost, 0);
    
    // Calculate content optimization
    const compressionRatios = recentProcessing.map(p => p.compressionRatio);
    const averageCompressionRatio = this.calculateAverage(compressionRatios);
    const totalBytesSaved = recentProcessing.reduce((sum, p) => 
      sum + (p.originalContentSize - p.optimizedContentSize), 0
    );
    
    // Calculate processing method effectiveness
    const singleRequestAttempts = recentProcessing.filter(p => p.processingType === 'single_request');
    const chunkedProcessingAttempts = recentProcessing.filter(p => p.processingType === 'chunked_processing');
    const singleRequestSuccess = singleRequestAttempts.length > 0 
      ? singleRequestAttempts.filter(p => p.success).length / singleRequestAttempts.length 
      : 0;
    const chunkedProcessingSuccess = chunkedProcessingAttempts.length > 0 
      ? chunkedProcessingAttempts.filter(p => p.success).length / chunkedProcessingAttempts.length 
      : 0;
    
    // Calculate quality scores
    const designCoherenceScores = recentQuality.map(q => q.designCoherenceScore);
    const contentCompletenessScores = recentQuality.map(q => q.contentCompletenessScore);
    const userRatings = recentQuality.map(q => q.userRating).filter(r => r !== undefined) as number[];
    
    return {
      timeRange: { start, end: now },
      totalRequests,
      successfulRequests,
      failedRequests,
      successRate,
      averageProcessingTime,
      medianProcessingTime,
      totalProcessingTime,
      totalTokensUsed,
      tokensByModel,
      averageTokensPerRequest,
      totalRateLimitEvents,
      totalWaitTime,
      averageWaitTime,
      totalImagesProcessed,
      totalImagesPreserved,
      overallPreservationRate,
      criticalImagesLost,
      averageCompressionRatio,
      totalBytesSaved,
      singleRequestSuccess,
      chunkedProcessingSuccess,
      averageDesignCoherence: this.calculateAverage(designCoherenceScores),
      averageContentCompleteness: this.calculateAverage(contentCompletenessScores),
      averageUserRating: this.calculateAverage(userRatings)
    };
  }
  
  /**
   * Get recent rate limit events for debugging
   */
  getRecentRateLimitEvents(count: number = 10): RateLimitMetrics[] {
    return this.rateLimitMetrics
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, count);
  }
  
  /**
   * Get image preservation failures for analysis
   */
  getImagePreservationFailures(): ImagePreservationMetrics[] {
    return this.imageMetrics.filter(m => m.preservationRate < 1.0);
  }
  
  /**
   * Get processing failures for debugging
   */
  getProcessingFailures(count: number = 10): ProcessingMetrics[] {
    return this.processingMetrics
      .filter(p => !p.success)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, count);
  }
  
  /**
   * Export all metrics for external analysis
   */
  exportMetrics(): {
    requests: RequestMetrics[];
    rateLimits: RateLimitMetrics[];
    images: ImagePreservationMetrics[];
    processing: ProcessingMetrics[];
    quality: QualityMetrics[];
  } {
    return {
      requests: [...this.requestMetrics],
      rateLimits: [...this.rateLimitMetrics],
      images: [...this.imageMetrics],
      processing: [...this.processingMetrics],
      quality: [...this.qualityMetrics]
    };
  }
  
  /**
   * Clear all metrics (for testing/cleanup)
   */
  clearMetrics(): void {
    this.requestMetrics = [];
    this.rateLimitMetrics = [];
    this.imageMetrics = [];
    this.processingMetrics = [];
    this.qualityMetrics = [];
  }
  
  /**
   * Get real-time dashboard data
   */
  getDashboardData(): {
    currentTokensPerMinute: { gpt5: number; gpt4o: number };
    rateLimitStatus: { gpt5: 'healthy' | 'warning' | 'critical'; gpt4o: 'healthy' | 'warning' | 'critical' };
    recentErrors: string[];
    imagePreservationTrend: number[]; // last 10 requests
    averageProcessingTime: number; // last hour
    activeProcessing: number;
  } {
    const now = Date.now();
    const lastMinute = now - 60 * 1000;
    const lastHour = now - 60 * 60 * 1000;
    
    // Calculate tokens per minute
    const recentRequests = this.requestMetrics.filter(r => r.timestamp >= lastMinute);
    const gpt5Tokens = recentRequests.filter(r => r.model === 'gpt-5').reduce((sum, r) => sum + r.tokensUsed, 0);
    const gpt4oTokens = recentRequests.filter(r => r.model === 'gpt-4o').reduce((sum, r) => sum + r.tokensUsed, 0);
    
    // Determine rate limit status
    const gpt5Status = gpt5Tokens > 25000 ? 'critical' : gpt5Tokens > 20000 ? 'warning' : 'healthy';
    const gpt4oStatus = gpt4oTokens > 600000 ? 'critical' : gpt4oTokens > 500000 ? 'warning' : 'healthy';
    
    // Get recent errors
    const recentErrors = this.requestMetrics
      .filter(r => !r.success && r.timestamp >= lastHour)
      .map(r => r.error || 'Unknown error')
      .slice(0, 5);
    
    // Image preservation trend (last 10 requests)
    const imagePreservationTrend = this.imageMetrics
      .slice(-10)
      .map(m => m.preservationRate);
    
    // Average processing time (last hour)
    const hourlyRequests = this.requestMetrics.filter(r => r.timestamp >= lastHour);
    const averageProcessingTime = hourlyRequests.length > 0 
      ? hourlyRequests.reduce((sum, r) => sum + r.processingTime, 0) / hourlyRequests.length 
      : 0;
    
    // Active processing (estimate based on recent requests without completion)
    const activeProcessing = this.processingMetrics.filter(p => 
      p.timestamp >= now - 5 * 60 * 1000 && // Last 5 minutes
      (p.chunksProcessed < (p.totalChunks || 1)) // Not yet complete
    ).length;
    
    return {
      currentTokensPerMinute: { gpt5: gpt5Tokens, gpt4o: gpt4oTokens },
      rateLimitStatus: { gpt5: gpt5Status, gpt4o: gpt4oStatus },
      recentErrors,
      imagePreservationTrend,
      averageProcessingTime,
      activeProcessing
    };
  }
  
  /**
   * Helper: Calculate average of numbers
   */
  private calculateAverage(numbers: number[]): number {
    if (numbers.length === 0) return 0;
    return numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
  }
  
  /**
   * Helper: Calculate median of numbers
   */
  private calculateMedian(numbers: number[]): number {
    if (numbers.length === 0) return 0;
    const sorted = [...numbers].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 
      ? (sorted[mid - 1] + sorted[mid]) / 2 
      : sorted[mid];
  }
  
  /**
   * Helper: Trim metrics arrays to prevent memory bloat
   */
  private trimMetrics<T>(metricsArray: T[]): void {
    if (metricsArray.length > this.MAX_METRICS_STORED) {
      metricsArray.splice(0, metricsArray.length - this.MAX_METRICS_STORED);
    }
  }
}

// Singleton instance for application use
export const metricsCollector = MetricsCollector.getInstance();

// Helper functions for common metrics operations
export const MetricsUtils = {
  /**
   * Start timing an operation
   */
  startTimer(): () => number {
    const start = Date.now();
    return () => Date.now() - start;
  },
  
  /**
   * Record a successful request
   */
  recordSuccess(model: string, tokensUsed: number, processingTime: number, chunkId?: string): void {
    metricsCollector.recordRequest({
      model: model as any,
      tokensRequested: tokensUsed,
      tokensUsed,
      processingTime,
      success: true,
      chunkId
    });
  },
  
  /**
   * Record a failed request
   */
  recordFailure(model: string, tokensRequested: number, error: string, chunkId?: string): void {
    metricsCollector.recordRequest({
      model: model as any,
      tokensRequested,
      tokensUsed: 0,
      processingTime: 0,
      success: false,
      error,
      chunkId
    });
  },
  
  /**
   * Record image preservation stats
   */
  recordImageStats(original: number, preserved: number, lostSources: string[] = [], criticalLost: number = 0): void {
    metricsCollector.recordImagePreservation({
      originalImageCount: original,
      preservedImageCount: preserved,
      lostImages: lostSources,
      criticalImagesLost: criticalLost,
      productImagesLost: lostSources.filter(src => 
        src.includes('product') || src.includes('item') || src.includes('shop')
      ).length
    });
  },
  
  /**
   * Get current performance snapshot
   */
  getPerformanceSnapshot(): {
    tokensPerMinute: number;
    averageResponseTime: number;
    successRate: number;
    imagePreservationRate: number;
  } {
    const summary = metricsCollector.getSummary(60 * 1000); // Last minute
    return {
      tokensPerMinute: summary.totalTokensUsed,
      averageResponseTime: summary.averageProcessingTime,
      successRate: summary.successRate,
      imagePreservationRate: summary.overallPreservationRate
    };
  }
};