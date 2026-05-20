const { GoogleGenerativeAI } = require('@google/generative-ai');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function generateAnimeQuote(animeName, targetWordCount, retries = 4) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const prompt = `Generate a memorable, meaningful quote from the anime "${animeName}".
The quote should be approximately ${targetWordCount} words long.
Return ONLY the quote text — no quotation marks, no character name, no explanation.
The quote must be in English.`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      return result.response.text().trim().replace(/^["'"']|["'"']$/g, '').trim();
    } catch (err) {
      const isRetryable = err.message && (err.message.includes('503') || err.message.includes('429') || err.message.includes('overloaded') || err.message.includes('high demand'));
      if (!isRetryable || attempt === retries) throw err;
      const delay = Math.min(1000 * 2 ** attempt + Math.random() * 500, 16000);
      console.warn(`Gemini attempt ${attempt + 1} failed, retrying in ${Math.round(delay)}ms...`);
      await sleep(delay);
    }
  }
}

module.exports = { generateAnimeQuote };
