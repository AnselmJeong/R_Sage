import { describe, expect, test } from "bun:test";
import { encodeFrame, encodeMessage, FrameDecoder, greeting, readyCommand } from "../src/index";

describe("zmtp framing", () => {
  test("greeting is 64 bytes with NULL mechanism", () => {
    const g = greeting();
    expect(g.length).toBe(64);
    expect(g[0]).toBe(0xff);
    expect(g[9]).toBe(0x7f);
    expect(g.subarray(12, 16).toString()).toBe("NULL");
  });

  test("short and long frames round-trip, split across chunks", () => {
    const small = Buffer.from("hello");
    const big = Buffer.alloc(70000, 7);
    const wire = encodeMessage([small, big]);
    const dec = new FrameDecoder();
    const frames = [...dec.push(wire.subarray(0, 3)), ...dec.push(wire.subarray(3, 5000)), ...dec.push(wire.subarray(5000))];
    expect(frames.length).toBe(2);
    expect(frames[0]!.body.toString()).toBe("hello");
    expect(frames[0]!.more).toBe(true);
    expect(frames[1]!.body.length).toBe(70000);
    expect(frames[1]!.more).toBe(false);
  });

  test("READY command carries socket type", () => {
    const f = readyCommand({ "Socket-Type": "DEALER" });
    const [frame] = new FrameDecoder().push(f);
    expect(frame!.command).toBe(true);
    expect(frame!.body.subarray(1, 6).toString()).toBe("READY");
    expect(frame!.body.includes(Buffer.from("DEALER"))).toBe(true);
    expect(encodeFrame(Buffer.alloc(0), false)[1]).toBe(0);
  });
});
