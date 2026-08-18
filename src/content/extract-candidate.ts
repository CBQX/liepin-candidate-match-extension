import type {
  CandidateDraft,
  ExtractedSection
} from "../shared/contracts/candidate";
import {
  collapseWhitespace,
  extractVisibleText,
  isElementVisible
} from "./extract-visible-text";
import {
  sectionForHeading,
  type CandidateSection
} from "./section-aliases";
import {
  isSupportedLiepinCandidateDetailPage,
  type LiepinPageLocation
} from "../shared/liepin-page";

export class UnsupportedPageError extends Error {
  constructor() {
    super("仅支持猎聘候选人页面");
    this.name = "UnsupportedPageError";
  }
}

function emptySection(): ExtractedSection {
  return { text: "", status: "missing" };
}

function extractedSection(parts: readonly string[]): ExtractedSection {
  const text = collapseWhitespace(parts.join(" "));
  if (!text) {
    return emptySection();
  }

  return {
    text,
    status: text.length >= 12 ? "complete" : "possibly_incomplete"
  };
}

function findHeadings(body: HTMLElement): Map<Element, CandidateSection> {
  const headings = new Map<Element, CandidateSection>();

  for (const element of body.querySelectorAll("*")) {
    if (!isElementVisible(element)) {
      continue;
    }

    const section = sectionForHeading(extractVisibleText(element));
    if (section) {
      headings.set(element, section);
    }
  }

  return headings;
}

function belongsToHeading(node: Node, headings: ReadonlyMap<Element, CandidateSection>): boolean {
  for (let element = node.parentElement; element; element = element.parentElement) {
    if (headings.has(element)) {
      return true;
    }
  }
  return false;
}

export function extractCandidate(
  sourceDocument: Document,
  sourceLocation: LiepinPageLocation
): CandidateDraft {
  if (!isSupportedLiepinCandidateDetailPage(sourceLocation)) {
    throw new UnsupportedPageError();
  }

  const body = sourceDocument.body;
  const headings = findHeadings(body);
  const collected: Record<CandidateSection, string[]> = {
    basics: [],
    workExperience: [],
    projects: [],
    education: [],
    skills: [],
    other: []
  };
  let currentSection: CandidateSection | undefined;
  const walker = sourceDocument.createTreeWalker(
    body,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT
  );

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const section = headings.get(node as Element);
      if (section) {
        currentSection = section;
      }
      continue;
    }

    if (!currentSection || belongsToHeading(node, headings)) {
      continue;
    }

    const parent = node.parentElement;
    if (parent && isElementVisible(parent)) {
      const text = collapseWhitespace(node.textContent ?? "");
      if (text) {
        collected[currentSection].push(text);
      }
    }
  }

  const draft: CandidateDraft = {
    basics: extractedSection(collected.basics),
    workExperience: extractedSection(collected.workExperience),
    projects: extractedSection(collected.projects),
    education: extractedSection(collected.education),
    skills: extractedSection(collected.skills),
    other: extractedSection(collected.other),
    extractionConfidence: "low"
  };
  const semanticCount = ([
    "basics",
    "workExperience",
    "projects",
    "education",
    "skills"
  ] as const).filter((section) => draft[section].status !== "missing").length;

  if (semanticCount < 2) {
    const fallbackText = extractVisibleText(body);
    draft.other = fallbackText
      ? { text: fallbackText, status: "possibly_incomplete" }
      : emptySection();
    draft.extractionConfidence = "low";
  } else {
    draft.extractionConfidence = semanticCount >= 3 ? "high" : "medium";
  }

  return draft;
}
