import { describe, expect, it } from "vitest";
import { concedingBuyer, concedingSeller, negotiate } from "../src/negotiation";

describe("negotiate", () => {
  it.each([
    [50, 45],
    [100, 90],
    [700, 550],
    [60, 60],
  ])("agrees on a price within [floor, max] when max %d >= floor %d", (max, floor) => {
    const { price, transcript } = negotiate(concedingBuyer("buyer", max), concedingSeller("seller", floor));
    expect(price).not.toBeNull();
    expect(price!).toBeGreaterThanOrEqual(floor);
    expect(price!).toBeLessThanOrEqual(max);
    expect(transcript.at(-1)).toMatchObject({ action: "ACCEPT", amount: price });
  });

  it("walks away when there is no zone of agreement", () => {
    const { price, transcript } = negotiate(concedingBuyer("buyer", 500), concedingSeller("seller", 600));
    expect(price).toBeNull();
    expect(transcript.at(-1)).toMatchObject({ action: "DECLINE" });
  });
});
