/** Offline hints are presentation only; raw article text remains unchanged. */
export type InlineGloss = { lemma: string; translation: string };
export type GlossMap = Record<string, InlineGloss>;
export type ReaderToken = {
  text: string;
  word: boolean;
  gloss?: InlineGloss;
};
export type ReaderParagraph = {
  text: string;
  separatorBefore: string;
  tokens: ReaderToken[];
};

const wordPattern = /^[A-Za-z]+(?:['’-][A-Za-z]+)*$/;

/** One hint per dictionary lemma, across the entire article rather than per paragraph. */
export function annotateArticle(text: string, glosses: GlossMap): ReaderParagraph[] {
  const seen = new Set<string>();
  const pieces = text.split(/(\n\n+)/);
  const paragraphs: ReaderParagraph[] = [];
  for (let i = 0; i < pieces.length; i += 2) {
    const paragraph = pieces[i];
    paragraphs.push({
      text: paragraph,
      separatorBefore: i ? pieces[i - 1] : "",
      tokens: paragraph.split(/([A-Za-z]+(?:['’-][A-Za-z]+)*)/g).map((token) => {
        const word = wordPattern.test(token);
        // Capitalized tokens are conservatively left alone, including sentence starts.
        const key = token.toLowerCase().replace(/’/g, "'");
        const candidate = word && token === token.toLowerCase() && Object.hasOwn(glosses, key)
          ? glosses[key]
          : undefined;
        const lemma = candidate?.lemma.toLowerCase();
        if (!candidate || !lemma || !candidate.translation.trim() || seen.has(lemma))
          return { text: token, word };
        seen.add(lemma);
        return { text: token, word, gloss: candidate };
      }),
    });
  }
  return paragraphs;
}

/**
 * Clone selected original paragraphs and remove display-only glosses. Reading
 * selection.toString() directly can include aria-hidden / user-select:none text.
 * Restrict extraction to the article body so sidebar, heading and controls are
 * never sent to lookup, vocabulary or AI by a drag that leaves the body.
 */
export function rawReaderSelection(
  selection: Selection | null,
  body: HTMLElement | null,
): string {
  if (!selection || !body || selection.isCollapsed || !selection.rangeCount) return "";
  const paragraphs = Array.from(body.querySelectorAll<HTMLElement>("[data-reader-paragraph]"));
  const parts: string[] = [];
  for (let r = 0; r < selection.rangeCount; r++) {
    const source = selection.getRangeAt(r);
    let rangeText = "";
    let hasParagraph = false;
    for (const paragraph of paragraphs) {
      if (!source.intersectsNode(paragraph)) continue;
      const bounds = paragraph.ownerDocument.createRange();
      bounds.selectNodeContents(paragraph);
      const clipped = source.cloneRange();
      if (clipped.compareBoundaryPoints(Range.START_TO_START, bounds) < 0)
        clipped.setStart(bounds.startContainer, bounds.startOffset);
      if (clipped.compareBoundaryPoints(Range.END_TO_END, bounds) > 0)
        clipped.setEnd(bounds.endContainer, bounds.endOffset);
      if (clipped.collapsed) continue;
      // A range can start or end within the gloss span, whose wrapper then isn't
      // included in cloneContents. Exclude that endpoint at the source as well.
      const startElement = clipped.startContainer.nodeType === Node.ELEMENT_NODE
        ? clipped.startContainer as Element
        : clipped.startContainer.parentElement;
      const endElement = clipped.endContainer.nodeType === Node.ELEMENT_NODE
        ? clipped.endContainer as Element
        : clipped.endContainer.parentElement;
      const startGloss = startElement?.closest("[data-inline-gloss]");
      const endGloss = endElement?.closest("[data-inline-gloss]");
      if (startGloss && startGloss === endGloss) continue;
      if (startGloss) clipped.setStartAfter(startGloss);
      if (endGloss) clipped.setEndBefore(endGloss);
      const clean = clipped.cloneContents();
      clean.querySelectorAll("[data-inline-gloss]").forEach((node) => node.remove());
      if (hasParagraph) rangeText += paragraph.dataset.readerSeparator || "\n\n";
      rangeText += clean.textContent || "";
      hasParagraph = true;
    }
    if (hasParagraph) parts.push(rangeText);
  }
  return parts.join("\n");
}
