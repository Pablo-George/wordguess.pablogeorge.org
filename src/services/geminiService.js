const { GoogleGenerativeAI } = require('@google/generative-ai');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function generateAnimeQuote(animeName, targetWordCount, retries = 4) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });

  const prompt = `You are an anime expert with deep knowledge of "${animeName}".

Select a memorable, meaningful line of dialogue from "${animeName}" that is approximately ${targetWordCount} words long.

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

module.exports = { generateAnimeQuote };
