const { GoogleGenerativeAI } = require('@google/generative-ai');

async function generateAnimeQuote(animeName, targetWordCount) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const prompt = `Generate a memorable, meaningful quote from the anime "${animeName}".
The quote should be approximately ${targetWordCount} words long.
Return ONLY the quote text — no quotation marks, no character name, no explanation.
The quote must be in English.`;

  const result = await model.generateContent(prompt);
  return result.response.text().trim().replace(/^["'"']|["'"']$/g, '').trim();
}

module.exports = { generateAnimeQuote };
