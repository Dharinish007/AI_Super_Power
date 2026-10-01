/**
 * ChatGPT Context Monitor - Attachment Detector
 *
 * Detects observable files, images, documents, and canvas artifacts attached
 * to user prompts or assistant responses, estimating token impact where defensible.
 */

import { queryGroups } from './tool-detector.js';

// OpenAI vision models use ~85 base tokens (low detail) or ~765-1105 (high detail tiles): a conservative
// calibrated estimate per image (also used for images in the conversation API, conversation-client.js)
export const CHATGPT_IMAGE_TOKENS = 300;

const ATTACHMENT_GROUPS = [
  "img[alt*='Uploaded image'], [data-testid='attachment-thumbnail']",
  "[data-testid='file-attachment'], div[class*='file-pill'], div[class*='file-attachment']"
];

export class AttachmentDetector {
  /**
   * Scans DOM for observable attachments.
   * @param {Document|HTMLElement} root
   * @returns {{ count: number, files: Array<{ name: string, type: string, size: string|null, estimatedTokens: number, isUnknown: boolean }>, estimatedTokens: number, hasUnknown: boolean }}
   */
  detect(root = document) {
    // One page traversal for both kinds (see queryGroups in tool-detector.js)
    const [imageElements, fileChips] = queryGroups(root, ATTACHMENT_GROUPS);

    const images = imageElements.map((_, i) => ({
      name: `Image Attachment ${i + 1}`, type: 'image', size: null, estimatedTokens: CHATGPT_IMAGE_TOKENS, isUnknown: false
    }));

    // Documents (PDFs, spreadsheets, code files) are ingested server-side: their token cost is unknown
    const documents = fileChips.map((chip, i) => {
      const nameEl = chip.querySelector("div[class*='font-semibold'], span[class*='text-sm'], .truncate");
      const size = chip.textContent.match(/(\d+(?:\.\d+)?\s*(?:KB|MB|bytes))/i);
      return { name: nameEl ? nameEl.textContent.trim() : `File ${i + 1}`, type: 'document', size: size ? size[0] : null, estimatedTokens: 0, isUnknown: true };
    });

    const files = [...images, ...documents];
    return {
      count: files.length,
      files,
      estimatedTokens: images.length * CHATGPT_IMAGE_TOKENS,
      hasUnknown: documents.length > 0
    };
  }
}
