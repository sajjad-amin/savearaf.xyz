/**
 * Input sanitization and phone normalization utility
 * Strips HTML tags/scripts (XSS protection) and normalizes input data
 */

export function stripHtml(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .trim();
}

export function sanitizeName(input: unknown): string {
  const stripped = stripHtml(input).replace(/\s+/g, ' ');
  return stripped.slice(0, 255);
}

export function sanitizePhone(input: unknown): string {
  const stripped = stripHtml(input);
  // Remove whitespace, dashes, parentheses, and dots
  const cleaned = stripped.replace(/[\s\-\(\)\.]/g, '');
  return cleaned.slice(0, 50);
}

export function sanitizeLocation(input: unknown): string | null {
  const stripped = stripHtml(input).replace(/\s+/g, ' ');
  return stripped.length > 0 ? stripped.slice(0, 255) : null;
}

/**
 * Generates matching variants for phone numbers to handle local (01...) vs international (+8801...) format
 */
export function getPhoneVariants(phone: string): string[] {
  const variants = new Set<string>();
  if (!phone) return [];

  variants.add(phone);

  // If starts with +8801...
  if (phone.startsWith('+8801')) {
    const local = '01' + phone.slice(5);
    variants.add(local);
    variants.add(phone.slice(1)); // 8801...
  }
  // If starts with 8801...
  else if (phone.startsWith('8801')) {
    const local = '01' + phone.slice(4);
    variants.add(local);
    variants.add('+' + phone); // +8801...
  }
  // If starts with 01...
  else if (phone.startsWith('01')) {
    variants.add('+88' + phone);
    variants.add('88' + phone);
  }

  return Array.from(variants);
}
