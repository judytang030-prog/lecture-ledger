// Telling speakers apart. Pure functions (no page access), so
// tests/speakers.test.js can check them.

// Two steps: lines join a small group when their voice fingerprints are very
// similar (LINE_SIMILARITY, cosine); then groups whose overall voices are close
// (GROUP_SIMILARITY) are merged. A whole group's voice is steadier than one
// line's, so the second step can be looser. Measured with WeSpeaker on two
// voices: same person 0.42–0.85 (lowest for a 0.8 s line), different people 0.14–0.18.
export const LINE_SIMILARITY = 0.5;
export const GROUP_SIMILARITY = 0.32;
// A "speaker" with only a line or two (and under 10% of lines) is usually a
// stray line of someone else. When two or more people already each speak at
// least 10% of the lines (a podcast host and guest), a stray always joins the
// one it sounds most like: one-line third speakers were 0.20–0.26 alike their
// real speaker, overlapping the 0.14–0.24 measured between different people,
// so similarity alone can't decide. With one main speaker (a lecture), a stray
// joins only when at least STRAY_LINE_SIMILARITY alike, so a student's single
// question stays separate.
export const STRAY_LINE_SIMILARITY = 0.23;
const MAX_STRAY_LINES = 2;
const MAX_STRAY_SHARE = 0.1;
const MAIN_SPEAKER_SHARE = 0.1;

function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / Math.sqrt(normA * normB);
}

function addInto(sum, embedding) {
  for (let i = 0; i < sum.length; i++) sum[i] += embedding[i];
}

// Gives each line a speaker number (0, 1, …, in order of first appearance).
// embeddings: one voice fingerprint per line, or null when the line was too
// short to tell; those lines take the speaker of the line before (or after).
// speakerCount: how many people are speaking, if known; otherwise decided
// from how alike the voices are. onDetails, if given, receives numbers that
// explain the result (for the diagnostics log).
export function groupSpeakers(embeddings, { speakerCount = null, onDetails = () => {} } = {}) {
  // Step 1: small groups of near-identical voices. Each group keeps the sum of
  // its fingerprints, whose direction is the group's voice.
  const groups = [];
  const groupOfLine = embeddings.map((embedding) => {
    if (!embedding) return null;
    let bestGroup = -1;
    let bestSimilarity = -Infinity;
    groups.forEach((group, index) => {
      const similarity = cosineSimilarity(embedding, group.sum);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestGroup = index;
      }
    });
    if (bestGroup >= 0 && bestSimilarity >= LINE_SIMILARITY) {
      addInto(groups[bestGroup].sum, embedding);
      return bestGroup;
    }
    groups.push({ sum: Float32Array.from(embedding) });
    return groups.length - 1;
  });

  // Step 2: merge the two most alike groups until there are speakerCount of
  // them, or (when the count isn't known) until no two are alike enough.
  const clusters = groups.map((group, index) => ({ sum: group.sum, groupIndexes: [index] }));
  const mergeSimilarities = [];
  let closestUnmerged = null;
  while (clusters.length > 1 && (speakerCount === null || clusters.length > speakerCount)) {
    let bestPair = null;
    let bestSimilarity = -Infinity;
    for (let a = 0; a < clusters.length; a++) {
      for (let b = a + 1; b < clusters.length; b++) {
        const similarity = cosineSimilarity(clusters[a].sum, clusters[b].sum);
        if (similarity > bestSimilarity) {
          bestSimilarity = similarity;
          bestPair = [a, b];
        }
      }
    }
    if (speakerCount === null && bestSimilarity < GROUP_SIMILARITY) {
      closestUnmerged = bestSimilarity;
      break;
    }
    mergeSimilarities.push(bestSimilarity);
    const [a, b] = bestPair;
    addInto(clusters[a].sum, clusters[b].sum);
    clusters[a].groupIndexes.push(...clusters[b].groupIndexes);
    clusters.splice(b, 1);
  }
  const lineCount = (cluster) =>
    groupOfLine.filter((group) => group !== null && cluster.groupIndexes.includes(group)).length;
  const strayLimit = Math.min(MAX_STRAY_LINES, embeddings.length * MAX_STRAY_SHARE);
  if (speakerCount === null) {
    for (const stray of [...clusters].sort((a, b) => lineCount(a) - lineCount(b))) {
      if (clusters.length < 2 || lineCount(stray) > strayLimit) break;
      const others = clusters.filter((cluster) => cluster !== stray);
      const similarities = others.map((cluster) => cosineSimilarity(stray.sum, cluster.sum));
      const best = Math.max(...similarities);
      const mainSpeakers = others.filter((cluster) => lineCount(cluster) >= embeddings.length * MAIN_SPEAKER_SHARE);
      if (mainSpeakers.length < 2 && best < STRAY_LINE_SIMILARITY) continue;
      const joined = others[similarities.indexOf(best)];
      addInto(joined.sum, stray.sum);
      joined.groupIndexes.push(...stray.groupIndexes);
      clusters.splice(clusters.indexOf(stray), 1);
      mergeSimilarities.push(best);
    }
  }

  const clusterOfGroup = new Map();
  clusters.forEach((cluster, clusterIndex) => {
    for (const groupIndex of cluster.groupIndexes) clusterOfGroup.set(groupIndex, clusterIndex);
  });
  const clusterSimilarities = [];
  for (let a = 0; a < clusters.length; a++) {
    for (let b = a + 1; b < clusters.length; b++) clusterSimilarities.push(cosineSimilarity(clusters[a].sum, clusters[b].sum));
  }
  onDetails({
    smallGroups: groups.length,
    mergeSimilarities,
    closestUnmerged,
    clusterLineCounts: clusters.map((_, clusterIndex) => groupOfLine.filter((group) => clusterOfGroup.get(group) === clusterIndex).length),
    clusterSimilarities,
  });

  // Number speakers in order of first appearance, and fill in the short lines.
  const speakerOfCluster = new Map();
  const speakers = groupOfLine.map((group) => {
    if (group === null) return null;
    const cluster = clusterOfGroup.get(group);
    if (!speakerOfCluster.has(cluster)) speakerOfCluster.set(cluster, speakerOfCluster.size);
    return speakerOfCluster.get(cluster);
  });
  for (let i = 0; i < speakers.length; i++) {
    if (speakers[i] === null) speakers[i] = speakers[i - 1] ?? null;
  }
  for (let i = speakers.length - 1; i >= 0; i--) {
    if (speakers[i] === null) speakers[i] = speakers[i + 1] ?? 0;
  }
  return speakers;
}

// "Speaker 1", "Speaker 2", … for the speaker numbers from groupSpeakers().
export function speakerNames(speakers) {
  const count = Math.max(...speakers) + 1;
  return Array.from({ length: count }, (_, index) => `Speaker ${index + 1}`);
}
