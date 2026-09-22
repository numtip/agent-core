import Fastify from "fastify";
import { loadConfig, type RuntimeConfig } from "./config.js";
import { JevProvider } from "./providers/jev.js";
import {
  decisionRequestSchema,
  decisionResponseSchema
} from "./schemas.js";
import {
  DecisionService,
  DecisionUnavailableError
} from "./services/decision.js";

export type AppDependencies = {
  config?: RuntimeConfig;
  provider?: JevProvider;
};

export function buildApp(deps: AppDependencies = {}) {
  const config = deps.config ?? loadConfig();
  const provider = deps.provider ?? new JevProvider(config);
  const service = new DecisionService(config, provider);

  const app = Fastify({ logger: true });

  app.get("/v1/health", async () => ({
    status: "ok",
    service: "agent-core",
    version: "0.1.0",
    jev_model: config.jevModel,
    provider_configured: Boolean(config.openRouterApiKey)
  }));

  app.post("/v1/decision", async (request, reply) => {
    const parsed = decisionRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "INVALID_REQUEST",
        details: parsed.error.flatten()
      });
    }

    try {
      const result = await service.decide(parsed.data);
      return decisionResponseSchema.parse(result);
    } catch (error) {
      if (error instanceof DecisionUnavailableError) {
        request.log.error({ err: error }, "decision provider unavailable");
        return reply.code(503).send({
          error: "DECISION_UNAVAILABLE",
          message: error.message
        });
      }

      throw error;
    }
  });

  // Phase 1 aliases use the same bounded decision contract.
  app.post("/v1/route", async (request, reply) => {
    const parsed = decisionRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "INVALID_REQUEST",
        details: parsed.error.flatten()
      });
    }
    return service.decide(parsed.data);
  });

  app.post("/v1/qa", async (request, reply) => {
    const parsed = decisionRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "INVALID_REQUEST",
        details: parsed.error.flatten()
      });
    }
    return service.decide(parsed.data);
  });

  return app;
}
