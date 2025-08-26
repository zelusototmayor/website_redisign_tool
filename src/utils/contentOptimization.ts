import * as cheerio from 'cheerio';

// Tracking scripts to remove
const ANALYTICS_PATTERNS = [
  /google-analytics\.com/i,
  /googletagmanager\.com/i,
  /gtag\(/i,
  /ga\(/i,
  /_gaq/i,
  /facebook\.net/i,
  /fbevents/i,
  /twitter\.com\/i\/adsct/i,
  /linkedin\.com\/px-api/i,
  /hotjar\./i,
  /crazyegg\./i,
  /optimizely\./i,
  /segment\./i,
  /mixpanel\./i,
  /intercom\./i,
  /zendesk\./i,
  /livechat/i,
  /hubspot/i
];

const IRRELEVANT_SELECTORS = [
  // Analytics and tracking
  'script[src*="analytics"]',
  'script[src*="gtag"]',
  'script[src*="facebook"]',
  'script[src*="twitter"]',
  'script[src*="linkedin"]',
  'script[src*="hotjar"]',
  'script[src*="optimizely"]',
  'script[src*="segment"]',
  'script[src*="mixpanel"]',
  
  // Chat widgets and popups
  'script[src*="intercom"]',
  'script[src*="zendesk"]',
  'script[src*="livechat"]',
  'script[src*="tawk.to"]',
  '.intercom-frame',
  '.zendesk-widget',
  '.livechat-widget',
  
  // Cookie consent and GDPR
  '[class*="cookie"]',
  '[id*="cookie"]',
  '[class*="gdpr"]',
  '[class*="consent"]',
  '.cookie-banner',
  '.privacy-banner',
  
  // Social media widgets (not images)
  'iframe[src*="facebook.com/plugins"]',
  'iframe[src*="twitter.com/widgets"]',
  'iframe[src*="linkedin.com/widgets"]',
  '.fb-like',
  '.twitter-tweet',
  '.linkedin-widget',
  
  // Advertisement containers
  '[class*="ad-"]',
  '[class*="ads-"]',
  '[id*="ad-"]',
  '[id*="ads-"]',
  '.advertisement',
  '.google-ads',
  '.adsense'
];

export class ContentOptimizer {
  // Compress HTML by removing unnecessary whitespace and comments
  static compressHTML(html: string): string {
    return html
      .replace(/<!--[\s\S]*?-->/g, '') // Remove comments
      .replace(/\s+/g, ' ') // Normalize whitespace
      .replace(/>\s+</g, '><') // Remove whitespace between tags
      .trim();
  }

  // Compress CSS by removing comments, unused imports, and unnecessary whitespace  
  static compressCSS(css: string): string {
    return css
      .replace(/\/\*[\s\S]*?\*\//g, '') // Remove comments
      .replace(/@import\s+url\([^)]+\);?/gi, '') // Remove @import statements
      .replace(/@import\s+["'][^"']+["'];?/gi, '') // Remove @import with quotes
      .replace(/-webkit-[^;]+;/gi, '') // Remove webkit prefixes
      .replace(/-moz-[^;]+;/gi, '') // Remove moz prefixes
      .replace(/-ms-[^;]+;/gi, '') // Remove ms prefixes
      .replace(/-o-[^;]+;/gi, '') // Remove opera prefixes
      .replace(/\s+/g, ' ') // Normalize whitespace
      .replace(/;\s*}/g, '}') // Remove unnecessary semicolons before closing braces
      .replace(/\s*{\s*/g, '{') // Remove whitespace around opening braces
      .replace(/;\s*/g, ';') // Normalize semicolons
      .replace(/}\s*/g, '}') // Remove whitespace after closing braces
      .trim();
  }

  // Aggressively compress JavaScript by removing analytics and unnecessary code
  static compressJS(js: string): string {
    let compressed = js;
    
    // Remove analytics and tracking code
    for (const pattern of ANALYTICS_PATTERNS) {
      compressed = compressed.replace(new RegExp(pattern.source, 'gi'), '');
    }
    
    // Remove common tracking function calls
    compressed = compressed
      .replace(/gtag\([^)]*\);?/gi, '') // Remove gtag calls
      .replace(/ga\([^)]*\);?/gi, '') // Remove ga calls
      .replace(/_gaq\.[^;]*;?/gi, '') // Remove _gaq calls
      .replace(/fbq\([^)]*\);?/gi, '') // Remove Facebook pixel calls
      .replace(/\$\.get\([^}]*}\);?/gi, '') // Remove AJAX tracking calls
      .replace(/\$\.post\([^}]*}\);?/gi, '') // Remove AJAX tracking calls
      .replace(/console\.[^;]*;?/gi, '') // Remove console statements
      .replace(/\/\*[\s\S]*?\*\//g, '') // Remove multi-line comments
      .replace(/\/\/.*$/gm, '') // Remove single-line comments
      .replace(/\s+/g, ' ') // Normalize whitespace
      .replace(/;\s*;/g, ';') // Remove double semicolons
      .trim();
    
    return compressed;
  }

  // Split large content into chunks for processing
  static chunkContent(content: string, maxChunkSize: number = 10000): string[] {
    if (content.length <= maxChunkSize) {
      return [content];
    }

    const chunks: string[] = [];
    let currentChunk = '';
    const sentences = content.split(/[.!?]\s+/);

    for (const sentence of sentences) {
      if (currentChunk.length + sentence.length > maxChunkSize && currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = sentence;
      } else {
        currentChunk += (currentChunk ? '. ' : '') + sentence;
      }
    }

    if (currentChunk) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }

  // Remove irrelevant content while preserving ALL images
  static removeIrrelevantContent(html: string): string {
    const $ = cheerio.load(html);
    
    // CRITICAL: Store all images before any removal
    const allImages: { element: cheerio.Element; html: string }[] = [];
    $('img').each((_: number, element: cheerio.Element) => {
      allImages.push({ element, html: $.html(element) });
    });
    
    // Remove irrelevant selectors (but NOT images)
    for (const selector of IRRELEVANT_SELECTORS) {
      $(selector).not('img').not(':has(img)').remove();
    }
    
    // Remove scripts with analytics patterns
    $('script').each((_, element) => {
      const $script = $(element);
      const src = $script.attr('src') || '';
      const content = $script.html() || '';
      
      const isAnalytics = ANALYTICS_PATTERNS.some(pattern => 
        pattern.test(src) || pattern.test(content)
      );
      
      if (isAnalytics) {
        $script.remove();
      }
    });
    
    // Remove heavy inline SVGs (>10KB) but preserve small icons
    $('svg').each((_, element) => {
      const svgHtml = $.html(element) || '';
      if (svgHtml.length > 10000) {
        $(element).replaceWith('<div class="svg-placeholder">[Large SVG removed for optimization]</div>');
      }
    });
    
    // Remove empty elements (but not img, input, br, hr)
    $('*').not('img, input, br, hr, area, base, col, embed, source, track, wbr').each((_, element) => {
      const $el = $(element);
      if (!$el.text().trim() && !$el.find('img, input, br, hr').length) {
        $el.remove();
      }
    });
    
    // CRITICAL: Re-insert any lost images
    const currentImages = new Set();
    $('img').each((_: number, element: cheerio.Element) => {
      const src = $(element).attr('src');
      if (src) currentImages.add(src);
    });
    
    // Find and restore any missing images
    for (const { html: imageHtml } of allImages) {
      const $img = cheerio.load(imageHtml)('img');
      const src = $img.attr('src');
      if (src && !currentImages.has(src)) {
        // Image was accidentally removed, restore it
        $('body').append(imageHtml);
        console.warn(`Restored accidentally removed image: ${src.substring(0, 50)}...`);
      }
    }
    
    return $.html();
  }
  
  // Extract only essential content for redesign
  static extractEssentialContent(html: string): string {
    const contentSelectors = [
      'main',
      'article', 
      '.content',
      '#content',
      '.main-content',
      'header',
      'nav',
      'footer',
      'h1, h2, h3, h4, h5, h6',
      'p',
      'ul, ol',
      '.hero',
      '.banner',
      '.product',
      '.products',
      '.gallery',
      '.shop',
      '.catalog'
    ];

    // Always remove irrelevant content first
    const cleanedHtml = this.removeIrrelevantContent(html);
    
    // If still too large after cleaning, extract essential sections
    if (cleanedHtml.length > 75000) { // Increased threshold after cleaning
      const $ = cheerio.load(cleanedHtml);
      
      let extractedContent = '';
      for (const selector of contentSelectors) {
        $(selector).each((_: number, element: cheerio.Element) => {
          extractedContent += $.html(element) + '\n';
        });
      }
      
      return extractedContent || cleanedHtml.substring(0, 75000);
    }

    return cleanedHtml;
  }

  // Optimize website data for processing
  static optimizeWebsiteData(data: {
    html: string;
    css: string;
    javascript: string;
  }): {
    html: string;
    css: string;
    javascript: string;
  } {
    return {
      html: this.compressHTML(this.extractEssentialContent(data.html)),
      css: this.compressCSS(data.css),
      javascript: this.compressJS(data.javascript)
    };
  }

  // Calculate content size in KB
  static getContentSize(content: string): number {
    return new Blob([content]).size / 1024;
  }

  // Check if content needs optimization
  static needsOptimization(data: {
    html: string;
    css: string;
    javascript: string;
  }): boolean {
    const totalSize = this.getContentSize(data.html + data.css + data.javascript);
    return totalSize > 500; // 500KB threshold (more aggressive)
  }
  
  // Count preserved images after optimization
  static countPreservedImages(originalHtml: string, optimizedHtml: string): {
    original: number;
    preserved: number;
    preservationRate: number;
  } {
    const originalImages = (originalHtml.match(/<img[^>]*>/g) || []).length;
    const preservedImages = (optimizedHtml.match(/<img[^>]*>/g) || []).length;
    
    return {
      original: originalImages,
      preserved: preservedImages,
      preservationRate: originalImages > 0 ? preservedImages / originalImages : 1
    };
  }
  
  // Validate that critical images are preserved
  static validateImagePreservation(originalHtml: string, optimizedHtml: string): {
    success: boolean;
    issues: string[];
    warnings: string[];
  } {
    const issues: string[] = [];
    const warnings: string[] = [];
    
    const originalImages = originalHtml.match(/<img[^>]*src=["']([^"']*)["'][^>]*>/g) || [];
    const optimizedImages = optimizedHtml.match(/<img[^>]*src=["']([^"']*)["'][^>]*>/g) || [];
    
    const originalSrcs = new Set(
      originalImages.map(img => {
        const match = img.match(/src=["']([^"']*)["']/);
        return match ? match[1] : '';
      }).filter(src => src)
    );
    
    const optimizedSrcs = new Set(
      optimizedImages.map(img => {
        const match = img.match(/src=["']([^"']*)["']/);
        return match ? match[1] : '';
      }).filter(src => src)
    );
    
    // Check for missing images
    for (const src of originalSrcs) {
      if (!optimizedSrcs.has(src)) {
        if (src.startsWith('data:image/') || src.includes('product') || src.includes('hero')) {
          issues.push(`Critical image missing: ${src.substring(0, 50)}...`);
        } else {
          warnings.push(`Decorative image missing: ${src.substring(0, 50)}...`);
        }
      }
    }
    
    return {
      success: issues.length === 0,
      issues,
      warnings
    };
  }
}