import { expect, test } from "bun:test";
import { pickUtf8Locale } from "../src/ark";

const mac = ["C", "C.UTF-8", "en_US.UTF-8", "en_GB.UTF-8", "ko_KR.UTF-8", "ja_JP.UTF-8"];

test("uses the region's UTF-8 locale when it exists", () => {
  expect(pickUtf8Locale("ko_KR", mac)).toBe("ko_KR.UTF-8");
  expect(pickUtf8Locale("en_GB", mac)).toBe("en_GB.UTF-8");
});

test("falls back when the region has no locale (English in Korea)", () => {
  expect(pickUtf8Locale("en_KR", mac)).toBe("en_US.UTF-8");
  expect(pickUtf8Locale("ja_KR", mac)).toBe("ja_JP.UTF-8");
  expect(pickUtf8Locale("xx_YY", mac)).toBe("en_US.UTF-8");
});
