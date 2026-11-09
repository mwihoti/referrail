import directory from "@/data/creators.json";
import type { CreatorMatch, Offer } from "@/lib/types";

/**
 * Creator matching: scores the small opted-in/fictional directory against an
 * offer. Deterministic and explainable, so judges can see why a creator was
 * suggested (and the agent never claims more than a keyword match).
 */

interface DirectoryCreator {
  account: string;
  name: string;
  tags: string[];
  audience: string;
  sampleUrl: string;
}

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "that", "this", "you", "your", "our", "from", "a", "an", "of", "to",
  "in", "on", "is", "are", "i", "we", "my", "it", "at", "by", "be", "get", "all", "each", "class",
]);

function keywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2 && !STOP_WORDS.has(word)),
  );
}

export function matchCreators(offer: Pick<Offer, "title" | "description" | "commission_bps">, limit = 3): CreatorMatch[] {
  const offerWords = keywords(`${offer.title} ${offer.description}`);
  const creators = directory.creators as DirectoryCreator[];

  const scored = creators.map((creator) => {
    const matchedTags = creator.tags.filter((tag) => offerWords.has(tag.toLowerCase()));
    const audienceWords = keywords(creator.audience);
    const audienceOverlap = [...offerWords].filter((word) => audienceWords.has(word));
    const score = matchedTags.length * 10 + audienceOverlap.length * 2;
    return { creator, matchedTags, score };
  });

  return scored
    .sort((a, b) => b.score - a.score || a.creator.name.localeCompare(b.creator.name))
    .slice(0, limit)
    .map(({ creator, matchedTags, score }) => {
      const reason =
        matchedTags.length > 0
          ? `Covers ${matchedTags.join(", ")} — matches this offer's wording.`
          : "Broad audience fit; no exact keyword overlap, so treat this as a low-confidence suggestion.";
      return {
        account: creator.account,
        name: creator.name,
        tags: creator.tags,
        audience: creator.audience,
        sampleUrl: creator.sampleUrl,
        score,
        reason,
      };
    });
}
