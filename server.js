require("dotenv").config();
const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("."));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const OPENAI_KEY = process.env.OPENAI_KEY;

// Genera un embedding del texto usando OpenAI
async function generarEmbedding(texto) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: texto,
    }),
  });
  const data = await res.json();
  if (!data.data) throw new Error("Error al generar embedding: " + JSON.stringify(data));
  return data.data[0].embedding;
}

// Busca documentos similares en Supabase usando pgvector
async function buscarContexto(texto) {
  try {
    const embedding = await generarEmbedding(texto);

    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/match_documentos`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        query_embedding: embedding,
        match_threshold: 0.5,
        match_count: 5,
      }),
    });

    const docs = await res.json();
    if (!Array.isArray(docs) || docs.length === 0) return "";

    return docs
      .map((d) => `### ${d.titulo}\n${d.contenido}`)
      .join("\n\n");
  } catch (err) {
    console.error("Error buscando contexto:", err.message);
    return "";
  }
}

// Endpoint principal del chat
app.post("/api/chat", async (req, res) => {
  const { messages } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "Se requiere un array de messages" });
  }

  try {
    // El último mensaje del usuario es el que usamos para buscar contexto
    const ultimoMensajeUsuario = [...messages]
      .reverse()
      .find((m) => m.role === "user");

    const contexto = ultimoMensajeUsuario
      ? await buscarContexto(ultimoMensajeUsuario.content)
      : "";

    const systemPrompt = `Sos el asistente virtual de Plan Out para productores de eventos. Estás para ayudarlos a operar la plataforma de gestión de entradas.
Escribís como un argentino: sin signos de apertura (¡ ¿), con voseo natural, tono directo y cercano pero profesional. Sin emojis.
Tus respuestas no superan los 4 o 5 renglones. Si el tema necesita más desarrollo, lo dividís en partes y preguntás si quiere seguir.
Cuando expliques pasos, usás listas cortas — máximo 4 o 5 ítems por vez.
Si no tenés certeza sobre algo, no inventás. Le decís que lo vas a derivar con el equipo de soporte de Plan Out.

INFORMACIÓN DISPONIBLE:
${contexto || "No se encontró información específica para esta consulta."}`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        max_tokens: 300,
        messages: [{ role: "system", content: systemPrompt }, ...messages],
      }),
    });

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error("Error en /api/chat:", err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
