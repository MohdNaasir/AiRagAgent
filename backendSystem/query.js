import * as dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import { Pinecone } from '@pinecone-database/pinecone';
import { GoogleGenAI } from "@google/genai";

const app = express();
app.use(express.json());

// Enable CORS with credentials
app.use(cors({
  origin: 'https://ai-rag-agent-32z2.vercel.app', // replace with your frontend URL
  credentials: true
}));

const ai = new GoogleGenAI({});
const History = [];

// Initialize embeddings and Pinecone index
const embeddings = new GoogleGenerativeAIEmbeddings({
  apiKey: process.env.GEMINI_API_KEY,
  model: 'text-embedding-004',
});
const pinecone = new Pinecone();
const pineconeIndex = pinecone.Index(process.env.PINECONE_INDEX_NAME);

// Rewrites follow-up question into standalone query
async function transformQuery(question) {
  History.push({ role: 'user', parts: [{ text: question }] });

  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash",
    contents: History,
    config: {
      systemInstruction: `You are a query rewriting expert. 
      Rephrase the "Follow Up user Question" into a complete, standalone question that can be understood without the chat history.
      Only output the rewritten question and nothing else.`,
    },
  });

  History.pop();
  return response.text;
}

// Main function to handle a chat query
async function chatWithDocument(question) {
  const queries = await transformQuery(question);
  const queryVector = await embeddings.embedQuery(queries);

  const searchResults = await pineconeIndex.query({
    topK: 10,
    vector: queryVector,
    includeMetadata: true,
  });

  let context = searchResults.matches
    .map(match => match.metadata.text)
    .join("\n\n---\n\n");

  context = context.replace(/\*/g, '-').replace(/_/g, '-');

  History.push({ role: 'user', parts: [{ text: queries }] });

  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash",
    contents: History,
    config: {
      systemInstruction: `You are a Data Structure and Algorithm Expert.
      Answer the user's question based ONLY on the provided context.
      If the answer is not in the context, respond: "I could not find the answer in the provided document."

      Context:
      \`\`\`
      ${context}
      \`\`\`
      `,
    },
  });

  History.push({ role: 'model', parts: [{ text: response.text }] });
  return response.text;
}

// --- API Endpoint for frontend
app.post('/ask', async (req, res) => {
  const { question } = req.body;
  if (!question) return res.status(400).json({ error: 'Question is required' });

  try {
    const answer = await chatWithDocument(question);
    res.json({ answer });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

app.listen(3000, () => {
  console.log('DSA Chatbot API running on http://localhost:3000');
});
