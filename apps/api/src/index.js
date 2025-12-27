import Fastify from "fastify";

const app = Fastify({ logger: true });

app.get("/healthz", async () => ({ ok: true }));

app.get("/projects", async () => ({ projects: [] }));

app.post("/chat", async (_request, reply) => {
  reply.code(501).send({ error: "Not implemented" });
});

app.post("/admin/reindex", async (_request, reply) => {
  reply.code(501).send({ error: "Not implemented" });
});

const port = Number(process.env.API_PORT || process.env.PORT || 3001);
const host = process.env.HOST || "0.0.0.0";

const start = async () => {
  try {
    await app.listen({ port, host });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
