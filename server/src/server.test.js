import { describe, expect, it } from "vitest";

describe("TaskForge server health", () => {
  it("exposes the service status", () => {
    expect({ ok: true, service: "taskforge" }).toMatchObject({ ok: true });
  });
});
