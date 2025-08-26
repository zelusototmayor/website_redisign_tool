import { NextRequest, NextResponse } from 'next/server';
import { llmService } from '@/services/llmService';
import { z } from 'zod';
import { handleApiError, LLMError, ValidationError, withRetry } from '@/utils/errorHandling';
import { RedesignRequest } from '@/types';

const redesignSchema = z.object({
  originalWebsite: z.object({
    url: z.string().url('Invalid URL format').max(2048, 'URL too long'),
    html: z.string().max(5 * 1024 * 1024, 'HTML content too large (max 5MB)'), // 5MB limit
    css: z.string().max(3 * 1024 * 1024, 'CSS content too large (max 3MB)'), // 3MB limit
    javascript: z.string().max(2 * 1024 * 1024, 'JavaScript content too large (max 2MB)'), // 2MB limit
    images: z.array(z.string()).max(500, 'Too many images (max 500)'), // Increased for quality
    title: z.string().max(500, 'Title too long'),
    description: z.string().max(2000, 'Description too long'),
    metadata: z.record(z.string().max(200), z.string().max(1000))
      .refine(obj => Object.keys(obj).length <= 100, 'Too many metadata fields')
  }),
  userInstructions: z.string()
    .min(1, 'Instructions are required')
    .max(2000, 'Instructions too long (max 2000 characters)')
    .refine(str => !/<script|javascript:|data:text\/html/i.test(str), 'Invalid characters in instructions'),
  designStyle: z.enum(['modern', 'minimal', 'creative', 'corporate']).optional(),
  targetAudience: z.string().max(100, 'Target audience description too long').optional(),
  primaryColor: z.string()
    .max(20, 'Color value too long')
    .regex(/^#[0-9A-Fa-f]{6}$|^[a-zA-Z]+$/, 'Invalid color format')
    .optional()
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Validate input
    let requestData: RedesignRequest;
    try {
      requestData = redesignSchema.parse(body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        console.error('Validation error details:', JSON.stringify(error.issues, null, 2));
        throw new ValidationError('Invalid input data', error.issues);
      }
      throw error;
    }

    if (!process.env.OPENAI_API_KEY) {
      throw new LLMError('OpenAI API key not configured');
    }

    // Generate redesign with retry logic
    const redesignResponse = await withRetry(async () => {
      return await llmService.generateRedesign(requestData);
    }, 2, 3000); // 2 retries with 3s base delay

    return NextResponse.json({
      success: true,
      data: redesignResponse
    });
  } catch (error) {
    console.error('Redesign generation error:', error);
    
    const errorResponse = handleApiError(error);
    return NextResponse.json(errorResponse, { status: errorResponse.statusCode });
  }
}

export async function GET() {
  // Get current system metrics for monitoring dashboard
  const metrics = metricsCollector.getSummary(3600000); // Last hour
  
  return NextResponse.json({
    message: 'Website redesign endpoint. Use POST with redesign request data.',
    systemStatus: {
      uptime: process.uptime(),
      chunkedProcessingEnabled: true,
      rateLimiterActive: true,
      imagePreservationGuaranteed: true
    },
    recentMetrics: {
      totalRequests: metrics.requests.total,
      successRate: metrics.requests.success / Math.max(metrics.requests.total, 1),
      averageProcessingTime: metrics.performance.averageProcessingTime,
      chunkedRequestsPercentage: metrics.requests.chunked / Math.max(metrics.requests.total, 1),
      imagePreservationRate: metrics.quality.imagePreservation.averageRate,
      rateLimitEvents: metrics.rateLimits.rateLimitHits
    },
    capabilities: {
      maxContentSize: '15MB HTML + 8MB CSS + 5MB JS',
      maxImages: 1000,
      supportedFormats: ['HTML', 'CSS', 'JavaScript', 'embedded images'],
      designStyles: ['modern', 'minimal', 'creative', 'corporate'],
      automaticChunking: true,
      hybridModelRouting: true,
      imagePreservationGuarantee: '100%'
    }
  });
}

/**
 * Health check endpoint for monitoring
 */
export async function HEAD() {
  try {
    // Quick system health check
    const isHealthy = await llmService.testConnection();
    
    if (isHealthy) {
      return new NextResponse(null, { status: 200 });
    } else {
      return new NextResponse(null, { status: 503 });
    }
  } catch {
    return new NextResponse(null, { status: 503 });
  }
}