/**
 * Content Chunker with Image-Aware Intelligence
 * Splits website content into logical sections while preserving image context
 */

import * as cheerio from 'cheerio';

export interface ImageAnalysis {
  count: number;
  totalEstimatedTokens: number;
  criticalImages: ImageInfo[];
  productImages: ImageInfo[];
  heroImages: ImageInfo[];
  decorativeImages: ImageInfo[];
}

export interface ImageInfo {
  src: string;
  alt: string;
  estimatedTokens: number;
  importance: 'critical' | 'product' | 'hero' | 'decorative';
  context: string; // surrounding HTML context
}

export interface ContentChunk {
  id: string;
  type: 'header' | 'nav' | 'hero' | 'main' | 'product' | 'gallery' | 'aside' | 'footer' | 'mixed';
  html: string;
  css: string;
  javascript: string;
  images: ImageInfo[];
  estimatedTokens: number;
  priority: 'critical' | 'high' | 'medium' | 'low';
  preserveOrder: boolean; // Must be processed in sequence
}

export interface ChunkingResult {
  chunks: ContentChunk[];
  totalEstimatedTokens: number;
  imageAnalysis: ImageAnalysis;
  metadata: {
    originalSize: number;
    optimizedSize: number;
    compressionRatio: number;
  };
}

/**
 * Smart content chunker that preserves image context and semantic structure
 */
export class ContentChunker {
  private static readonly CRITICAL_IMAGE_SELECTORS = [
    '.product img',
    '.product-image',
    '.product-photo',
    '.product-gallery img',
    '.shop img',
    '.catalog img',
    '.item-image',
    '[data-product-image]',
    '.hero img',
    '.hero-image',
    '.banner img',
    '.main-image'
  ];

  private static readonly SECTION_SELECTORS = {
    header: 'header, .header, .site-header, .main-header, [role="banner"]',
    nav: 'nav, .nav, .navigation, .navbar, .menu, [role="navigation"]',
    hero: '.hero, .hero-section, .banner, .jumbotron, .intro-section',
    main: 'main, .main, .main-content, .content, [role="main"]',
    product: '.product, .products, .shop, .catalog, .items, .product-grid, .product-list',
    gallery: '.gallery, .photo-gallery, .image-gallery, .portfolio',
    aside: 'aside, .aside, .sidebar, .side-content, [role="complementary"]',
    footer: 'footer, .footer, .site-footer, .main-footer, [role="contentinfo"]'
  };

  /**
   * Analyze images in HTML content
   */
  static analyzeImages(html: string): ImageAnalysis {
    const $ = cheerio.load(html);
    const images: ImageInfo[] = [];
    let totalTokens = 0;

    // Find all images
    $('img').each((_, element) => {
      const $img = $(element);
      const src = $img.attr('src') || '';
      const alt = $img.attr('alt') || '';
      
      if (!src) return;

      // Get surrounding context for classification
      const context = $img.closest('[class*="product"], [class*="hero"], [class*="gallery"], section, div').html() || '';
      
      // Estimate tokens (data URLs are token-heavy)
      const estimatedTokens = this.estimateImageTokens(src, context);
      totalTokens += estimatedTokens;

      // Classify image importance
      const importance = this.classifyImageImportance($img, context);

      images.push({
        src,
        alt,
        estimatedTokens,
        importance,
        context: context.substring(0, 200) // Limit context size
      });
    });

    // Categorize images
    const criticalImages = images.filter(img => img.importance === 'critical');
    const productImages = images.filter(img => img.importance === 'product');
    const heroImages = images.filter(img => img.importance === 'hero');
    const decorativeImages = images.filter(img => img.importance === 'decorative');

    return {
      count: images.length,
      totalEstimatedTokens: totalTokens,
      criticalImages,
      productImages,
      heroImages,
      decorativeImages
    };
  }

  /**
   * Classify image importance based on context
   */
  private static classifyImageImportance($img: cheerio.Cheerio, context: string): 'critical' | 'product' | 'hero' | 'decorative' {
    const src = $img.attr('src') || '';
    const alt = $img.attr('alt') || '';
    const className = $img.attr('class') || '';
    
    // Check if it's a data URL (embedded image) - these are usually important
    if (src.startsWith('data:image/')) {
      // Large data URLs are likely product/hero images
      if (src.length > 50000) { // ~50KB
        return 'critical';
      }
    }

    // Check critical image selectors
    for (const selector of this.CRITICAL_IMAGE_SELECTORS) {
      if ($img.is(selector) || $img.closest(selector.split(' ')[0]).length > 0) {
        return 'critical';
      }
    }

    // Product image indicators
    const productKeywords = ['product', 'item', 'shop', 'buy', 'catalog', 'store'];
    if (productKeywords.some(keyword => 
      alt.toLowerCase().includes(keyword) || 
      className.toLowerCase().includes(keyword) ||
      context.toLowerCase().includes(keyword)
    )) {
      return 'product';
    }

    // Hero image indicators
    const heroKeywords = ['hero', 'banner', 'main', 'featured', 'primary'];
    if (heroKeywords.some(keyword => 
      alt.toLowerCase().includes(keyword) || 
      className.toLowerCase().includes(keyword) ||
      context.toLowerCase().includes(keyword)
    )) {
      return 'hero';
    }

    // Check image position (first few images are usually important)
    const $allImages = $img.closest('body').find('img');
    const position = $allImages.index($img);
    if (position < 3 && src.length > 10000) { // Top 3 images with substantial size
      return 'hero';
    }

    return 'decorative';
  }

  /**
   * Estimate token count for an image
   */
  private static estimateImageTokens(src: string, context: string): number {
    if (src.startsWith('data:image/')) {
      // Data URLs: roughly 1 token per 3-4 characters
      return Math.ceil(src.length / 3.5);
    } else {
      // External images: count the URL and context
      return Math.ceil((src.length + context.length) / 4);
    }
  }

  /**
   * Split content into logical chunks while preserving image context
   */
  static chunkContent(html: string, css: string = '', javascript: string = ''): ChunkingResult {
    const $ = cheerio.load(html);
    const chunks: ContentChunk[] = [];
    const imageAnalysis = this.analyzeImages(html);
    const originalSize = html.length + css.length + javascript.length;

    let chunkId = 1;

    // Extract sections in priority order
    const sectionTypes: (keyof typeof this.SECTION_SELECTORS)[] = [
      'header', 'nav', 'hero', 'main', 'product', 'gallery', 'aside', 'footer'
    ];

    for (const sectionType of sectionTypes) {
      const selector = this.SECTION_SELECTORS[sectionType];
      const $sections = $(selector);

      $sections.each((_, element) => {
        const $section = $(element);
        const sectionHtml = $.html($section);
        
        if (!sectionHtml || sectionHtml.length < 50) return; // Skip tiny sections

        // Find images in this section
        const sectionImages: ImageInfo[] = [];
        $section.find('img').each((_, imgElement) => {
          const $img = $(imgElement);
          const src = $img.attr('src') || '';
          if (src) {
            const existingImage = imageAnalysis.criticalImages
              .concat(imageAnalysis.productImages, imageAnalysis.heroImages, imageAnalysis.decorativeImages)
              .find(img => img.src === src);
            if (existingImage) {
              sectionImages.push(existingImage);
            }
          }
        });

        // Calculate section tokens
        const sectionTokens = Math.ceil(sectionHtml.length / 4) + 
          sectionImages.reduce((sum, img) => sum + img.estimatedTokens, 0);

        // Determine priority based on images and section type
        let priority: 'critical' | 'high' | 'medium' | 'low' = 'medium';
        if (sectionImages.some(img => img.importance === 'critical' || img.importance === 'product')) {
          priority = 'critical';
        } else if (sectionImages.some(img => img.importance === 'hero') || sectionType === 'hero') {
          priority = 'high';
        } else if (sectionType === 'footer' || sectionType === 'nav') {
          priority = 'low';
        }

        chunks.push({
          id: `chunk-${chunkId++}`,
          type: sectionType,
          html: sectionHtml,
          css: this.extractRelevantCSS(css, $section),
          javascript: this.extractRelevantJS(javascript, $section),
          images: sectionImages,
          estimatedTokens: sectionTokens,
          priority,
          preserveOrder: sectionType === 'header' || sectionType === 'footer'
        });

        // Remove processed element to avoid duplicates
        $section.remove();
      });
    }

    // Handle any remaining content as mixed
    const remainingHtml = $('body').html() || '';
    if (remainingHtml.trim().length > 100) {
      const remainingImages = imageAnalysis.decorativeImages.filter(img => 
        remainingHtml.includes(img.src)
      );
      
      const remainingTokens = Math.ceil(remainingHtml.length / 4) + 
        remainingImages.reduce((sum, img) => sum + img.estimatedTokens, 0);

      chunks.push({
        id: `chunk-${chunkId++}`,
        type: 'mixed',
        html: remainingHtml,
        css: css, // Include all CSS for mixed content
        javascript: javascript, // Include all JS for mixed content
        images: remainingImages,
        estimatedTokens: remainingTokens,
        priority: 'low',
        preserveOrder: false
      });
    }

    // Calculate compression metrics
    const optimizedSize = chunks.reduce((sum, chunk) => 
      sum + chunk.html.length + chunk.css.length + chunk.javascript.length, 0
    );

    const totalTokens = chunks.reduce((sum, chunk) => sum + chunk.estimatedTokens, 0);

    return {
      chunks: this.sortChunksByPriority(chunks),
      totalEstimatedTokens: totalTokens,
      imageAnalysis,
      metadata: {
        originalSize,
        optimizedSize,
        compressionRatio: originalSize > 0 ? optimizedSize / originalSize : 1
      }
    };
  }

  /**
   * Sort chunks by priority and processing order
   */
  private static sortChunksByPriority(chunks: ContentChunk[]): ContentChunk[] {
    const priorityOrder = { 'critical': 0, 'high': 1, 'medium': 2, 'low': 3 };
    
    return chunks.sort((a, b) => {
      // First sort by priority
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      
      // Then by preserve order (header first, footer last)
      if (a.type === 'header') return -1;
      if (b.type === 'header') return 1;
      if (a.type === 'footer') return 1;
      if (b.type === 'footer') return -1;
      
      return 0;
    });
  }

  /**
   * Extract CSS relevant to a specific section
   */
  private static extractRelevantCSS(css: string, $section: cheerio.Cheerio): string {
    if (!css) return '';

    // Extract classes and IDs from the section
    const classNames: string[] = [];
    const ids: string[] = [];
    
    $section.find('*').addBack().each((_, element) => {
      const $el = cheerio.load(element)('*').first();
      const className = $el.attr('class');
      const id = $el.attr('id');
      
      if (className) {
        classNames.push(...className.split(' ').filter(c => c.trim()));
      }
      if (id) {
        ids.push(id);
      }
    });

    // Extract relevant CSS rules (simplified approach)
    const relevantCSS: string[] = [];
    const cssRules = css.split('}').filter(rule => rule.trim());

    for (const rule of cssRules) {
      const selector = rule.split('{')[0]?.trim();
      if (!selector) continue;

      // Check if rule applies to this section
      const applies = classNames.some(className => selector.includes(`.${className}`)) ||
                    ids.some(id => selector.includes(`#${id}`)) ||
                    selector.includes('body') || 
                    selector.includes('*') ||
                    selector.includes('@');

      if (applies) {
        relevantCSS.push(rule + '}');
      }
    }

    return relevantCSS.join('\n');
  }

  /**
   * Extract JavaScript relevant to a specific section
   */
  private static extractRelevantJS(javascript: string, $section: cheerio.Cheerio): string {
    if (!javascript) return '';
    
    // For now, return minimal JS or empty
    // In practice, this could be more sophisticated to extract only relevant scripts
    return javascript.length > 10000 ? '' : javascript;
  }

  /**
   * Estimate total tokens for chunked content
   */
  static estimateTokens(content: string): number {
    return Math.ceil(content.length / 4);
  }

  /**
   * Validate chunks meet size requirements
   */
  static validateChunkSizes(chunks: ContentChunk[], maxTokensPerChunk: number): boolean {
    return chunks.every(chunk => chunk.estimatedTokens <= maxTokensPerChunk);
  }

  /**
   * Split oversized chunks further if needed
   */
  static splitOversizedChunks(chunks: ContentChunk[], maxTokensPerChunk: number): ContentChunk[] {
    const result: ContentChunk[] = [];

    for (const chunk of chunks) {
      if (chunk.estimatedTokens <= maxTokensPerChunk) {
        result.push(chunk);
        continue;
      }

      // Split large chunk into smaller pieces
      const $ = cheerio.load(chunk.html);
      const subSections = $('section, article, div').get();
      
      if (subSections.length > 1) {
        let subChunkId = 1;
        for (const subSection of subSections) {
          const subHtml = cheerio.load(subSection).html() || '';
          const subTokens = this.estimateTokens(subHtml);
          
          if (subTokens <= maxTokensPerChunk) {
            result.push({
              ...chunk,
              id: `${chunk.id}-sub-${subChunkId++}`,
              html: subHtml,
              estimatedTokens: subTokens,
              images: chunk.images.filter(img => subHtml.includes(img.src))
            });
          }
        }
      } else {
        // If can't split further, keep as is (will need special handling)
        result.push(chunk);
      }
    }

    return result;
  }
}