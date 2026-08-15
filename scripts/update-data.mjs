#!/usr/bin/env node
/**
 * 카페 데이터 자동 갱신 스크립트
 *
 * 하는 일:
 *  1. 블로그 검색 API로 카페별 블로그 총 포스팅 수(blog)를 갱신
 *     - 소스 자동 선택: 네이버 키가 있으면 네이버, 없으면 카카오(KAKAO_REST_API_KEY)
 *     - ※ 네이버 개발자센터는 신규 앱의 '검색' API 발급이 중단됨(2026-08 확인).
 *       기존에 발급받은 네이버 키만 사용 가능하고, 신규는 카카오 키를 쓰세요.
 *  2. 최신 후기 스니펫에서 아이동반/노키즈존/애견동반 키워드를 스캔해 리포트 생성
 *     (kid/pet 필드는 자동으로 바꾸지 않고 경고만 출력 — 사람이 확인 후 반영)
 *  3. data/cafes.json 갱신 + 앱이 읽는 data.js 재생성
 *
 * 사용법:
 *   KAKAO_REST_API_KEY=xxx node scripts/update-data.mjs            # 카카오 (권장)
 *   NAVER_CLIENT_ID=xxx NAVER_CLIENT_SECRET=yyy node scripts/update-data.mjs
 *   node scripts/update-data.mjs --build-only   # API 호출 없이 data.js만 재생성
 *
 * 카카오 API 키 발급: https://developers.kakao.com → 내 애플리케이션 → 앱 추가 → 'REST API 키' 사용
 * (요구 환경: Node.js 18+)
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CAFES_PATH = path.join(ROOT, "data", "cafes.json");
const CHARGERS_PATH = path.join(ROOT, "data", "chargers.json");
const DATA_JS_PATH = path.join(ROOT, "data.js");
const REPORT_PATH = path.join(ROOT, "data", "report.json");

const BUILD_ONLY = process.argv.includes("--build-only");
const NAVER_ID = process.env.NAVER_CLIENT_ID;
const NAVER_SECRET = process.env.NAVER_CLIENT_SECRET;
const KAKAO_KEY = process.env.KAKAO_REST_API_KEY;
const SOURCE = NAVER_ID && NAVER_SECRET ? "naver" : KAKAO_KEY ? "kakao" : null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const strip = (s) => s.replace(/<\/?b>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

// 소스별 API 호출 → 공통 형태 { total, snippets: string[] } 로 반환
async function blogSearch(query) {
  if (SOURCE === "naver") {
    const url = `https://openapi.naver.com/v1/search/blog.json?query=${encodeURIComponent(query)}&display=10&sort=sim`;
    const res = await fetch(url, {
      headers: { "X-Naver-Client-Id": NAVER_ID, "X-Naver-Client-Secret": NAVER_SECRET },
    });
    if (!res.ok) throw new Error(`네이버 API 오류 ${res.status}: ${await res.text()}`);
    const json = await res.json();
    return { total: json.total, snippets: json.items.map((it) => strip(it.title + " " + it.description)) };
  }
  // 카카오 블로그 검색 (다음 블로그 검색 — 수치 스케일은 네이버와 다르지만 상대 비교용으로 사용)
  const url = `https://dapi.kakao.com/v2/search/blog?query=${encodeURIComponent(query)}&size=10&sort=accuracy`;
  const res = await fetch(url, { headers: { Authorization: `KakaoAK ${KAKAO_KEY}` } });
  if (!res.ok) throw new Error(`카카오 API 오류 ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return { total: json.meta.total_count, snippets: json.documents.map((d) => strip(d.title + " " + d.contents)) };
}

// 스니펫 키워드 스캔 (제목+본문에서 검색)
const KID_POS = ["아이랑", "아기랑", "아이와", "아기와", "아기의자", "유모차", "수유실", "키즈존", "키즈"];
const KID_NEG = ["노키즈존", "노키즈"];
const PET_POS = ["애견동반", "반려견 동반", "강아지 동반", "애견 동반"];

function scanSnippets(snippets) {
  const text = snippets.join("\n");
  const count = (words) => words.reduce((n, w) => n + (text.includes(w) ? 1 : 0), 0);
  return { kidPos: count(KID_POS), kidNeg: count(KID_NEG), petPos: count(PET_POS) };
}

async function main() {
  const cafesFile = JSON.parse(await readFile(CAFES_PATH, "utf8"));
  const chargersFile = JSON.parse(await readFile(CHARGERS_PATH, "utf8"));
  const warnings = [];

  if (!BUILD_ONLY) {
    if (!SOURCE) {
      console.error("❌ API 키 환경변수가 필요합니다. 둘 중 하나:");
      console.error("   KAKAO_REST_API_KEY=xxx                          (카카오 블로그 검색 — 권장, 신규 발급 가능)");
      console.error("   NAVER_CLIENT_ID=xxx NAVER_CLIENT_SECRET=yyy     (네이버 — 기존 발급 키만)");
      console.error("   API 호출 없이 data.js만 다시 만들려면: node scripts/update-data.mjs --build-only");
      process.exit(1);
    }

    // 소스가 바뀌면(예: naver → kakao) 수치 스케일이 달라 급감 경고가 무의미함
    const sourceChanged = cafesFile.source && cafesFile.source !== SOURCE;
    if (sourceChanged) {
      console.log(`ℹ️ 데이터 소스 전환: ${cafesFile.source} → ${SOURCE} (수치 스케일이 달라 이번 회차는 증감 비교를 생략합니다)`);
    }

    console.log(`🔄 [${SOURCE}] ${cafesFile.cafes.length}개 카페 블로그 수치 갱신 중...`);
    for (const cafe of cafesFile.cafes) {
      try {
        const res = await blogSearch(cafe.query);
        const prev = cafe.blog;
        cafe.blog = res.total;
        const diff = res.total - prev;
        console.log(`  ${cafe.name}: ${prev.toLocaleString()} → ${res.total.toLocaleString()} (${diff >= 0 ? "+" : ""}${diff.toLocaleString()})`);

        // 급감(-50% 이상)은 검색어 문제일 수 있으므로 경고 (소스 전환 회차는 제외)
        if (!(cafesFile.source && cafesFile.source !== SOURCE) && prev > 0 && res.total < prev * 0.5) {
          warnings.push({ cafe: cafe.name, type: "blog-drop", msg: `블로그 수 급감 (${prev} → ${res.total}). 검색어('${cafe.query}') 확인 필요.` });
        }

        const sig = scanSnippets(res.snippets);
        if (cafe.kid === "yes" && sig.kidNeg > 0) {
          warnings.push({ cafe: cafe.name, type: "kid-conflict", msg: "kid=yes 인데 최신 후기에 '노키즈존' 언급 발견. 정책 변경 여부 확인 필요." });
        }
        if (cafe.kid === "unknown" && sig.kidPos >= 3) {
          warnings.push({ cafe: cafe.name, type: "kid-upgrade", msg: `아이동반 긍정 키워드 ${sig.kidPos}종 발견. kid=yes 승격 검토.` });
        }
        if (!cafe.pet && sig.petPos > 0) {
          warnings.push({ cafe: cafe.name, type: "pet-upgrade", msg: "애견동반 언급 발견. pet=true 검토." });
        }
      } catch (e) {
        console.error(`  ⚠️ ${cafe.name} 갱신 실패: ${e.message}`);
        warnings.push({ cafe: cafe.name, type: "api-error", msg: e.message });
      }
      await sleep(150); // API 예의상 호출 간격
    }

    cafesFile.blogUpdatedAt = new Date().toISOString().slice(0, 10);
    cafesFile.source = SOURCE;
    await writeFile(CAFES_PATH, JSON.stringify(cafesFile, null, 2) + "\n");
    await writeFile(REPORT_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), warnings }, null, 2) + "\n");
    console.log(`\n📋 경고 ${warnings.length}건 → data/report.json`);
    warnings.forEach((w) => console.log(`  - [${w.type}] ${w.cafe}: ${w.msg}`));
  }

  // ── data.js 생성 (앱이 file:// 에서도 읽을 수 있도록 JS 전역으로 노출) ──
  // blogScale: 점수 산식의 로그 분모. 네이버 수치엔 4.3 고정(기존과 동일),
  // 카카오 등 스케일이 다른 소스는 데이터 내 최댓값 기준 상대 스케일로 자동 보정.
  const src = cafesFile.source || "naver";
  const maxLog = Math.log10(Math.max(...cafesFile.cafes.map((c) => Math.max(c.blog, 1))));
  const blogScale = src === "naver" ? 4.3 : Math.max(2.5, Math.round(maxLog * 100) / 100);
  const dataJs =
    "// 자동 생성 파일 — 직접 수정하지 마세요. (scripts/update-data.mjs 가 재생성)\n" +
    "// 원본: data/cafes.json, data/chargers.json\n" +
    "window.CAFE_DATA = " +
    JSON.stringify(
      { updatedAt: cafesFile.blogUpdatedAt, source: src, blogScale, cafes: cafesFile.cafes, chargers: chargersFile.chargers },
      null,
      1
    ) +
    ";\n";
  await writeFile(DATA_JS_PATH, dataJs);
  console.log(`✅ data.js 생성 완료 (기준일: ${cafesFile.blogUpdatedAt})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
