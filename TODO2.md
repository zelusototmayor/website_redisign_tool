# TODO2: Smart Chunking + Streaming + Image Preservation Implementation

## 🎯 **Goal**: Implement hybrid chunking solution that preserves ALL images while staying within GPT-5 rate limits (30K tokens/minute)

---

## **Git Repository Setup** 🔧
- [ ] Set up remote repository: `https://github.com/zelusototmayor/website_redisign_tool.git`
- [ ] Configure git remote if not already set
- [ ] Verify git status and prepare for structured commits

---

## **Phase 1: Core Infrastructure** ⚡

### **1.1 Token Bucket Rate Limiter (`src/utils/rateLimiter.ts`)**
- [ ] Create `TokenBucket` class with sliding window algorithm
- [ ] Track GPT-5 limit: 30,000 tokens/minute with 1-minute sliding window
- [ ] Track GPT-4o limit: separate bucket for fallback model
- [ ] Methods:
  - [ ] `canProcess(tokenCount: number, model: string): boolean`
  - [ ] `consumeTokens(tokenCount: number, model: string): void`
  - [ ] `getAvailableTokens(model: string): number`
  - [ ] `waitTimeForTokens(tokenCount: number, model: string): number`
- [ ] Metrics tracking:
  - [ ] Tokens consumed per minute
  - [ ] Requests queued/delayed
  - [ ] 429 errors encountered
  - [ ] Average wait times

### **1.2 Content Chunker (`src/utils/contentChunker.ts`)**
- [ ] Create `ContentChunker` class with smart HTML sectioning
- [ ] **Image Detection Logic:**
  - [ ] `detectImages(html: string): ImageAnalysis`
  - [ ] `classifyImageImportance(img: HTMLImageElement): 'critical' | 'product' | 'hero' | 'decorative'`
  - [ ] `countImageTokens(html: string): number` (estimate data URL size)
- [ ] **Content Sectioning:**
  - [ ] Extract semantic sections: `<header>`, `<nav>`, `<main>`, `<aside>`, `<footer>`
  - [ ] Detect content areas: `.hero`, `.product`, `.gallery`, `.content`
  - [ ] Preserve section relationships and context
- [ ] **Token Estimation:**
  - [ ] `estimateTokens(content: string): number` (chars/4 rule)
  - [ ] Account for data URLs in image-heavy sections
- [ ] **Prioritization Logic:**
  - [ ] Priority 1: Main content + product images (GPT-5)
  - [ ] Priority 2: Hero sections + critical images (GPT-5)
  - [ ] Priority 3: Navigation + text content (GPT-4o)
  - [ ] Priority 4: Footer + decorative content (GPT-4o)

### **1.3 Model Router (`src/utils/modelRouter.ts`)**
- [ ] Create `ModelRouter` class for intelligent model selection
- [ ] **Routing Logic:**
  - [ ] `routeContentChunk(chunk: ContentChunk): ModelSelection`
  - [ ] Route image-heavy sections to GPT-5
  - [ ] Route text-only sections to GPT-4o
  - [ ] Handle mixed content intelligently
- [ ] **Image Classification:**
  - [ ] Detect product images by context (`<img>` in `.product`, `.shop`, `.catalog`)
  - [ ] Identify hero images (first large image, background images in headers)
  - [ ] Classify by alt text keywords ("product", "buy", "item", "photo")
  - [ ] Size-based classification (>50KB = likely product image)
- [ ] **Budget Management:**
  - [ ] Allocate 20K tokens/min to GPT-5 for critical content
  - [ ] Allocate 10K tokens/min to GPT-4o for secondary content
  - [ ] 3K token buffer for safety margin

### **1.4 Git Commit - Phase 1 Complete** 🔄
- [ ] Stage all Phase 1 files (`git add src/utils/rateLimiter.ts src/utils/contentChunker.ts src/utils/modelRouter.ts`)
- [ ] Commit with message: `feat: implement core infrastructure (rate limiter, chunker, router)`
- [ ] Push to remote: `git push origin main`

---

## **Phase 2: Content Processing** 🔄

### **2.1 Enhanced Content Optimizer (`src/utils/contentOptimization.ts`)**
- [ ] **Irrelevant Content Removal (PRESERVE ALL IMAGES):**
  - [ ] Strip Google Analytics scripts (`gtag`, `analytics.js`, `ga.js`)
  - [ ] Remove Facebook Pixel, Twitter scripts, social tracking
  - [ ] Clean out A/B testing scripts (Optimizely, VWO)
  - [ ] Remove chat widgets, popups, cookie banners
  - [ ] Strip heavy inline SVGs >10KB (replace with placeholders)
  - [ ] Remove unused CSS (unused @import, vendor prefixes)
  - [ ] Clean redundant inline styles
- [ ] **Image Preservation Logic:**
  - [ ] NEVER remove `<img>` tags
  - [ ] Preserve all data URLs (product images embedded)
  - [ ] Keep responsive image attributes (`srcset`, `sizes`)
  - [ ] Maintain lazy loading attributes (`loading="lazy"`)
  - [ ] Preserve alt text and accessibility attributes
- [ ] **Quality Maintenance:**
  - [ ] Keep essential CSS (media queries, animations, grid/flexbox)
  - [ ] Preserve custom fonts and typography
  - [ ] Maintain interactive elements (forms, buttons)

### **2.2 Streaming LLM Service (`src/services/streamingLlmService.ts`)**
- [ ] Create `StreamingLLMService` class
- [ ] **Chunk Processing Pipeline:**
  - [ ] `processChunksSequentially(chunks: ContentChunk[]): Promise<RedesignResult>`
  - [ ] Rate-limited API calls using TokenBucket
  - [ ] Process high-priority (image-heavy) chunks first
  - [ ] Queue lower-priority chunks for available capacity
- [ ] **Model Integration:**
  - [ ] `callGPT5(chunk: ContentChunk): Promise<ChunkResult>`
  - [ ] `callGPT4o(chunk: ContentChunk): Promise<ChunkResult>`
  - [ ] Error handling and retry logic per model
- [ ] **Result Aggregation:**
  - [ ] `mergeChunkResults(results: ChunkResult[]): RedesignResponse`
  - [ ] Maintain design coherence across chunks
  - [ ] Preserve image references and context
  - [ ] Handle partial failures gracefully
- [ ] **Progress Reporting:**
  - [ ] Real-time status updates for UI
  - [ ] Track processing state per chunk
  - [ ] Report token usage and rate limiting status

### **2.3 Git Commit - Phase 2 Complete** 🔄
- [ ] Stage all Phase 2 files (`git add src/utils/contentOptimization.ts src/services/streamingLlmService.ts`)
- [ ] Commit with message: `feat: add content processing and streaming LLM service`
- [ ] Push to remote: `git push origin main`

---

## **Phase 3: Metrics & Monitoring** 📊

### **3.1 Metrics Service (`src/utils/metrics.ts`)**
- [ ] Create `MetricsCollector` class
- [ ] **Request Tracking:**
  - [ ] API calls per minute (GPT-5 vs GPT-4o)
  - [ ] Tokens sent/received per model
  - [ ] Average tokens per request
- [ ] **Rate Limit Monitoring:**
  - [ ] 429 errors encountered per model
  - [ ] Wait times due to rate limits
  - [ ] Recovery times after rate limit hits
- [ ] **Performance Metrics:**
  - [ ] Processing time: chunked vs single-request
  - [ ] Memory usage before/after content optimization
  - [ ] Chunk processing success rates
  - [ ] Image preservation success rate (should be 100%)
- [ ] **Quality Metrics:**
  - [ ] Images detected vs images preserved
  - [ ] Content sections successfully processed
  - [ ] Design coherence scores (subjective/user feedback)

### **3.2 Enhanced Prompts (`src/config/prompts.ts`)**
- [ ] **Chunk-Aware Prompts:**
  - [ ] Modify `buildRedesignPrompt()` for chunk-specific context
  - [ ] Add section type awareness (header, main, footer)
  - [ ] Preserve cross-section design consistency instructions
- [ ] **Image Preservation Instructions:**
  - [ ] Strengthen image preservation commands in prompts
  - [ ] Add specific product image handling instructions
  - [ ] Include responsive image best practices
- [ ] **Model-Specific Prompts:**
  - [ ] GPT-5 prompts: Focus on complex layouts + images
  - [ ] GPT-4o prompts: Focus on text content + simple styling

### **3.3 Git Commit - Phase 3 Complete** 🔄
- [ ] Stage all Phase 3 files (`git add src/utils/metrics.ts src/config/prompts.ts`)
- [ ] Commit with message: `feat: add metrics and monitoring systems`
- [ ] Push to remote: `git push origin main`

---

## **Phase 4: API Integration** 🔗

### **4.1 Updated LLM Service (`src/services/llmService.ts`)**
- [ ] Add `generateRedesignChunked(request: RedesignRequest): Promise<RedesignResponse>`
- [ ] **Auto-Detection Logic:**
  - [ ] Analyze content size and image count
  - [ ] Decide: single-request vs chunked approach
  - [ ] Fallback to original method for small sites
- [ ] **Integration with Streaming Service:**
  - [ ] Use StreamingLLMService for large/image-heavy sites
  - [ ] Maintain original service for small sites
  - [ ] Error handling and graceful degradation

### **4.2 API Route Updates (`src/app/api/redesign/route.ts`)**
- [ ] **Content Analysis:**
  - [ ] Add pre-processing content size detection
  - [ ] Image count and classification analysis
  - [ ] Automatic chunking decision logic
- [ ] **Progress Reporting:**
  - [ ] Implement streaming response for progress updates
  - [ ] Real-time chunk processing status
  - [ ] Token usage and rate limit status
- [ ] **Enhanced Error Handling:**
  - [ ] Rate limit specific error messages
  - [ ] Partial processing success handling
  - [ ] Retry logic for failed chunks
- [ ] **Metrics Integration:**
  - [ ] Log all processing metrics
  - [ ] Track success/failure rates
  - [ ] Monitor image preservation rates

### **4.3 Git Commit - Phase 4 Complete** 🔄
- [ ] Stage all Phase 4 files (`git add src/services/llmService.ts src/app/api/redesign/route.ts`)
- [ ] Commit with message: `feat: integrate API routes and LLM service updates`
- [ ] Push to remote: `git push origin main`

---

## **Phase 5: Frontend Updates** 🖥️

### **5.1 Progress Tracking UI**
- [ ] **Real-time Progress Bars:**
  - [ ] Overall processing progress
  - [ ] Individual chunk processing status
  - [ ] Model usage indicator (GPT-5 vs GPT-4o)
- [ ] **Rate Limit Status Display:**
  - [ ] Current token usage vs limits
  - [ ] Estimated wait times if rate limited
  - [ ] Queue position for delayed requests
- [ ] **Processing Details:**
  - [ ] Show which sections are being processed
  - [ ] Image count and preservation status
  - [ ] Processing time estimates

### **5.2 Enhanced Error Messages**
- [ ] **User-Friendly Rate Limit Messages:**
  - [ ] "Processing large website, this may take longer..."
  - [ ] "Preserving all images while respecting rate limits..."
  - [ ] Clear wait time estimates
- [ ] **Processing Status Updates:**
  - [ ] "Processing hero section with GPT-5..."
  - [ ] "Optimizing navigation with GPT-4o..."
  - [ ] "Preserving 47 product images..."

### **5.3 Git Commit - Phase 5 Complete** 🔄
- [ ] Stage all Phase 5 frontend files (`git add src/components/* src/app/page.tsx`)
- [ ] Commit with message: `feat: implement frontend progress tracking`
- [ ] Push to remote: `git push origin main`

---

## **Phase 6: Testing & Validation** ✅

### **6.1 Rate Limiting Tests**
- [ ] **Token Bucket Validation:**
  - [ ] Test rate limiting accuracy
  - [ ] Verify sliding window behavior
  - [ ] Test concurrent request handling
- [ ] **429 Error Handling:**
  - [ ] Simulate rate limit exceeded scenarios
  - [ ] Test retry logic and backoff
  - [ ] Verify graceful degradation

### **6.2 Image Preservation Tests**
- [ ] **Test Websites:**
  - [ ] E-commerce site with product catalogs (preserve ALL products)
  - [ ] Photography portfolio (preserve ALL gallery images)
  - [ ] Restaurant website (preserve food photos)
  - [ ] Corporate site (preserve team photos, logos)
- [ ] **Validation Logic:**
  - [ ] Count images before/after processing
  - [ ] Verify data URLs intact
  - [ ] Check responsive image attributes preserved
  - [ ] Validate alt text maintained

### **6.3 End-to-End Testing**
- [ ] **Original Problem Websites:**
  - [ ] Test with `http://www.pnwx.com/`
  - [ ] Test with `https://www.riversideartcenter.org/`
  - [ ] Verify successful processing without 429 errors
  - [ ] Confirm all images preserved
- [ ] **Performance Comparison:**
  - [ ] Measure: old single-request vs new chunked approach
  - [ ] Token usage efficiency
  - [ ] Processing time comparison
  - [ ] User experience improvements

### **6.4 Git Commit - Phase 6 Complete** 🔄
- [ ] Stage all test files and documentation (`git add test/* docs/* *.md`)
- [ ] Commit with message: `test: add comprehensive testing and validation`
- [ ] Push to remote: `git push origin main`
- [ ] Tag release: `git tag -a v2.0.0 -m "Smart chunking + image preservation release"`
- [ ] Push tags: `git push origin --tags`

---

## **Implementation Priority Order:**

1. **Phase 1** (Core Infrastructure) - 🔴 Critical
2. **Phase 2** (Content Processing) - 🔴 Critical  
3. **Phase 4.1** (LLM Service Integration) - 🟡 High
4. **Phase 4.2** (API Route Updates) - 🟡 High
5. **Phase 3** (Metrics & Monitoring) - 🟠 Medium
6. **Phase 5** (Frontend Updates) - 🟠 Medium
7. **Phase 6** (Testing & Validation) - 🟢 Important

---

## **Success Criteria:**

✅ **Zero Image Loss**: 100% of product/critical images preserved  
✅ **Rate Limit Compliance**: Stay within 30K tokens/minute for GPT-5  
✅ **Quality Maintenance**: Design coherence across chunked processing  
✅ **Performance**: Process previously failing websites successfully  
✅ **User Experience**: Clear progress indication and error messaging  
✅ **Measurable**: Comprehensive metrics on improvement vs old approach

---

## **Key Technical Decisions:**

- **Hybrid Model Strategy**: GPT-5 for images/critical content, GPT-4o for text/secondary
- **Image Classification**: Automatic detection of product vs decorative images
- **Token Budget Split**: 20K GPT-5, 10K GPT-4o, 3K buffer within 30K total limit
- **Processing Order**: Critical image content first, secondary content queued
- **Fallback Strategy**: Single-request for small sites, chunked for large/image-heavy

---

**Total Estimated Implementation Time**: 2-3 weeks  
**Immediate Impact**: Solve 429 rate limit errors while preserving ALL images