const { GoogleGenerativeAI } = require('@google/generative-ai');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function generateAnimeQuote(animeName, targetWordCount, usedQuotes = [], retries = 4) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });

  const avoidSection = usedQuotes.length > 0
    ? `\nDo NOT use any of these previously used quotes:\n${usedQuotes.map((q, i) => `${i + 1}. "${q}"`).join('\n')}\n`
    : '';

  const prompt = `You are an anime expert with deep knowledge of "${animeName}".

Select a memorable, meaningful line of dialogue from "${animeName}" that is approximately ${targetWordCount} words long.
${avoidSection}
Return ONLY a valid JSON object — no markdown, no code blocks, nothing else:
{
  "quote": "the line of dialogue in English",
  "character": "Character Name",
  "episode": "Episode 12",
  "timestamp": "~14:32"
}

Rules:
- Prefer real lines of dialogue from the show; if uncertain, choose something thematically authentic
- The quote must be in English (use the English subtitled/dubbed translation)
- Strip any surrounding quotation marks from the quote value
- episode and timestamp are your best estimate — it is okay if approximate`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      const raw = result.response.text().trim()
        .replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      const parsed = JSON.parse(raw);
      return {
        quote: (parsed.quote || '').replace(/^["'"']|["'"']$/g, '').trim(),
        character: parsed.character || null,
        episode: parsed.episode || null,
        timestamp: parsed.timestamp || null,
      };
    } catch (err) {
      const isRetryable =
        err instanceof SyntaxError ||
        (err.message && (
          err.message.includes('503') ||
          err.message.includes('429') ||
          err.message.includes('overloaded') ||
          err.message.includes('high demand')
        ));
      if (!isRetryable || attempt === retries) throw err;
      const delay = Math.min(1000 * 2 ** attempt + Math.random() * 500, 16000);
      console.warn(`Gemini attempt ${attempt + 1} failed, retrying in ${Math.round(delay)}ms...`);
      await sleep(delay);
    }
  }
}

async function generateZombieTheme(wordCount, wordLength = 5, retries = 3) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const prompt = `You are creating content for a collaborative Wordle-style word guessing game.
Players must guess ${wordCount} mystery ${wordLength}-letter word${wordCount > 1 ? 's' : ''} that ${wordCount > 1 ? 'all share' : 'belongs to'} a theme.

Choose a fun, specific theme and provide exactly ${wordCount} common ${wordLength}-letter English word${wordCount > 1 ? 's' : ''} that fit it.
Rules:
- Words must be exactly ${wordLength} letters, ALL CAPS
- Use only common everyday words a native English speaker would know
- No proper nouns, no abbreviations, no obscure words
- All words must be different from each other
- Theme should be specific and fun (e.g. "Things in a Kitchen" not just "Food")

Return ONLY valid JSON, no markdown, no explanation:
{"theme":"Theme Name Here","words":["WORD1","WORD2"]}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      const raw = result.response.text().trim()
        .replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      const parsed = JSON.parse(raw);
      if (!parsed.theme || !Array.isArray(parsed.words) || parsed.words.length !== wordCount) {
        throw new SyntaxError('Unexpected shape');
      }
      const words = parsed.words.map(w => String(w).toUpperCase().replace(/[^A-Z]/g, ''));
      if (words.some(w => w.length !== wordLength)) throw new SyntaxError('Bad word length');
      return { theme: parsed.theme.trim(), words };
    } catch (err) {
      const isRetryable =
        err instanceof SyntaxError ||
        (err.message && (
          err.message.includes('503') ||
          err.message.includes('429') ||
          err.message.includes('overloaded') ||
          err.message.includes('high demand')
        ));
      if (!isRetryable || attempt === retries) throw err;
      const delay = Math.min(1000 * 2 ** attempt + Math.random() * 500, 16000);
      console.warn(`Gemini zombie theme attempt ${attempt + 1} failed, retrying in ${Math.round(delay)}ms...`);
      await sleep(delay);
    }
  }
}

module.exports = { generateAnimeQuote, generateZombieTheme };
