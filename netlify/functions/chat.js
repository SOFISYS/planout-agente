const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const OPENAI_KEY = process.env.OPENAI_KEY;

async function generarEmbedding(texto) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({ model: "text-embedding-3-small", input: texto }),
  });
  const data = await res.json();
  if (!data.data) throw new Error("Error embedding: " + JSON.stringify(data));
  return data.data[0].embedding;
}

async function buscarContexto(texto) {
  try {
    const embedding = await generarEmbedding(texto);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/buscar_documentos`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ query_embedding: embedding, match_count: 5 }),
    });
    const docs = await res.json();
    if (!Array.isArray(docs) || docs.length === 0) return "";
    return docs.map((d) => `### ${d.titulo}\n${d.contenido}`).join("\n\n");
  } catch (err) {
    console.error("Error buscando contexto:", err.message);
    return "";
  }
}

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let message, historial;
  try {
    ({ message, historial } = JSON.parse(event.body));
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Body inválido" }) };
  }

  if (!message) {
    return { statusCode: 400, body: JSON.stringify({ error: "Se requiere el campo message" }) };
  }

  try {
    const contexto = await buscarContexto(message);

    const systemPrompt = `Sos el asistente virtual de Plan Out para productores de eventos. Estás para ayudarlos a operar la plataforma de gestión de entradas.
Escribís como un argentino: sin signos de apertura (¡ ¿), con voseo natural, tono directo y cercano pero profesional. Sin emojis.
Tus respuestas no superan los 4 o 5 renglones. Si el tema necesita más desarrollo, lo dividís en partes y preguntás si quiere seguir.
Cuando expliques pasos, usás listas cortas — máximo 4 o 5 ítems por vez.
Si no tenés certeza sobre algo, no inventás. Le decís que lo vas a derivar con el equipo de soporte de Plan Out.

INFORMACIÓN DISPONIBLE:
${contexto || "No se encontró información específica para esta consulta."}`;

    const messages = [
      { role: "system", content: systemPrompt },
      ...(Array.isArray(historial) ? historial : []),
    ];

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({ model: "gpt-4o", max_tokens: 300, messages }),
    });

    const data = await response.json();
    if (!data.choices?.[0]) {
      throw new Error(data.error?.message || "Sin respuesta de OpenAI");
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ respuesta: data.choices[0].message.content }),
    };
  } catch (err) {
    console.error("Error en función chat:", err.message);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
