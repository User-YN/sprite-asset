import { eventSource, event_types, saveSettingsDebounced, getRequestHeaders } from "../../../../script.js";
import { extension_settings, getContext } from "../../../extensions.js";
import {
    openDB, saveImage, loadImage, deleteImage,
    blobToBase64, base64ToBlob
} from "./src/storage.js";
import {
    extractEmotionFromFilename, compressImage,
    extractImageFromNaiZip, removeWhiteBackground
} from "./src/image.js";
import { callAnalysisProvider, getSTProfiles } from "./src/providers.js";
import { buildPanelHtml } from "./src/panel-html.js";

import { requestNaiImage, hasImageConnection } from "./src/nai-transport.mjs";

const extensionName = "dynamic-sprites";

// ====================================================================
// 기본 설정
// ====================================================================
const defaultSettings = {
    enabled: true,
    showSprite: true,
    transitionDuration: 300,
    customPrompt: "",
    relationContext: "",

    // API 모드: 'st' | 'st_profile' | 'gemini' | 'openai_compat'
    apiMode: "st",
    apiProfile: "", // ST Connection Profile 이름
    apiKey: "",
    apiEndpoint: "",
    apiModel: "",

    // === 데스크탑 표시 설정 ===
    desktopPosition: "bottom-left", // bottom-left, bottom-right, bottom-center
    desktopOffsetX: 20,    // px (가장자리로부터 떨어진 거리)
    desktopOffsetY: 0,     // px (바닥에서 위로 띄우는 거리)
    desktopHeight: 80,     // vh (화면 높이 대비 %)
    desktopMaxWidth: 400,  // px
    desktopOpacity: 100,   // %
    desktopZIndex: 100,

    // === 모바일 표시 설정 ===
    mobilePosition: "bottom-left",
    mobileOffsetX: 10,
    mobileOffsetY: 0,
    mobileHeight: 50,
    mobileMaxWidth: 200,
    mobileOpacity: 100,
    mobileZIndex: 100,
    mobileBreakpoint: 768, // 이 너비 이하면 모바일 설정 적용

    // === 표시 설정 프리셋 (이름 → 설정 스냅샷) ===
    displayPresets: {},

    // === 캐릭터 변경 시 알림 ===
    notifyCharChange: true,

    // === 테마 ===
    theme: "mono", // mono, rose, ivory, sky
    activeTab: "image",

    // === 사용자 정의 감정 별칭 ===
    // { "synonymWord": "canonicalLabel" } 형식
    // 예: { "ecstatic": "happy" } → AI가 "ecstatic" 뱉으면 "happy" 라벨로 매칭
    userAliases: {},

    // === origin 백업 (이미지 base64) - 자동복구용 ===
    // 키: imageKey → 값: base64 dataURL
    // 새 origin에서 IndexedDB 비어있으면 여기서 자동 복원
    imageBackup: {},
    autoBackup: true, // 이미지 업로드 시 자동으로 imageBackup에 백업

    // === 이미지 자동 압축 ===
    autoCompress: true,
    compressMaxDim: 800,    // px - 가장 긴 변 기준
    compressQuality: 85,    // 1-100 (WebP quality)

    // === NovelAI 이미지 생성 설정 ===
    naiConfig: {
        provider: "auto",
        apiKey: "",
        model: "nai-diffusion-4-5-full",
        width: 832,
        height: 1216,
        steps: 28,
        scale: 5,
        cfgRescale: 0,
        sampler: "k_euler_ancestral",
        stylePrompt: "",
        styleNegPrompt: "",
        seedLocked: false,
        lockedSeed: -1,
        autoRemoveBg: false,
        removeBgThreshold: 240,
        labelIntensity: 2
    },

    // 캐릭터별 감정 데이터 + 아코디언 펼침 상태
    characters: {},
    expandedChars: {} // { charName: true/false }
};

// ====================================================================
// 설정 로드
// ====================================================================
function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    if (Object.keys(extension_settings[extensionName]).length === 0) {
        Object.assign(extension_settings[extensionName], defaultSettings);
    }
    for (const key in defaultSettings) {
        if (extension_settings[extensionName][key] === undefined) {
            extension_settings[extensionName][key] = defaultSettings[key];
        }
    }
    return extension_settings[extensionName];
}

// ====================================================================
// 설정 바인딩 헬퍼 — DOM 요소 ↔ settings 경로 양방향 바인딩
//
// bindSetting(id, "naiConfig.steps")
//   → 슬라이더는 input 이벤트로 즉시 반영 + change에서 저장,
//     체크박스/text/number는 change 이벤트에서 둘 다.
//   → type 기반 자동 파싱 (checkbox=Boolean, number/range=Number, else=trimmed string)
//
// opts:
//   - valueLabelId: 슬라이더 값 미러링용 <span>
//   - onInput(v): 저장 전 사이드이펙트 (스타일 재계산, 행 토글 등)
//   - parser(rawValue): 커스텀 변환 (기본은 자동)
// ====================================================================
function setSettingsPath(path, value) {
    const parts = path.split(".");
    let o = extension_settings[extensionName];
    for (let i = 0; i < parts.length - 1; i++) {
        if (o[parts[i]] === undefined || o[parts[i]] === null) o[parts[i]] = {};
        o = o[parts[i]];
    }
    o[parts[parts.length - 1]] = value;
}

function bindSetting(id, path, opts = {}) {
    const { parser, valueLabelId, onInput } = opts;
    const el = document.getElementById(id);
    if (!el) return;
    const labelEl = valueLabelId ? document.getElementById(valueLabelId) : null;

    const autoParse = () => {
        if (el.type === "checkbox") return el.checked;
        if (el.type === "number" || el.type === "range") {
            const n = parseFloat(el.value);
            return Number.isFinite(n) ? n : 0;
        }
        return typeof el.value === "string" ? el.value.trim() : el.value;
    };

    const read = () => (parser ? parser(el.type === "checkbox" ? el.checked : el.value) : autoParse());

    const apply = () => {
        const v = read();
        setSettingsPath(path, v);
        if (labelEl) labelEl.textContent = v;
        onInput?.(v);
    };

    if (el.type === "range") {
        el.addEventListener("input", apply);
        el.addEventListener("change", saveSettingsDebounced);
    } else {
        el.addEventListener("change", () => {
            apply();
            saveSettingsDebounced();
        });
    }
}

function getCurrentCharName() {
    const context = getContext();
    return context.name2 || context.characters?.[context.characterId]?.name || null;
}

function getCharData(charName) {
    const settings = extension_settings[extensionName];
    if (!settings.characters[charName]) {
        settings.characters[charName] = {
            presets: { "기본": { emotions: [], current: null } },
            activePreset: "기본",
        };
    }
    const charData = settings.characters[charName];
    // Migration: old format { emotions[], current, naiGen } → preset format
    if (Array.isArray(charData.emotions)) {
        charData.presets = { "기본": { emotions: charData.emotions, current: charData.current ?? null } };
        charData.activePreset = "기본";
        delete charData.emotions;
        delete charData.current;
    }
    return charData;
}

function getActivePreset(charName) {
    const charData = getCharData(charName);
    return charData.presets[charData.activePreset]
        || charData.presets[Object.keys(charData.presets)[0]];
}

// ====================================================================
// 스프라이트 컨테이너
// ====================================================================
function createSpriteContainer() {
    if (document.getElementById("dynamic-sprite-container")) return;
    const container = document.createElement("div");
    container.id = "dynamic-sprite-container";
    container.innerHTML = `<img id="dynamic-sprite-img" alt="sprite">`;
    document.body.appendChild(container);
}

// ====================================================================
// 테마 적용
// ====================================================================
function applyTheme() {
    const settings = extension_settings[extensionName];
    const VALID = ["mono", "rose", "ivory", "sky"];
    // 구 테마(system/cream/peach/lilac) 또는 누락된 값은 mono로 마이그레이션
    if (!VALID.includes(settings.theme)) {
        settings.theme = "mono";
        saveSettingsDebounced();
    }
    document.body.setAttribute("data-ds-theme", settings.theme);
    document.querySelectorAll(".ds-theme-btn").forEach(btn => {
        btn.classList.toggle("ds-theme-active", btn.dataset.theme === settings.theme);
    });
}

// ====================================================================
// 표시 스타일 동적 적용 (CSS 변수 주입)
// ====================================================================
function applyDisplayStyles() {
    const settings = extension_settings[extensionName];
    let styleEl = document.getElementById("ds-dynamic-styles");
    if (!styleEl) {
        styleEl = document.createElement("style");
        styleEl.id = "ds-dynamic-styles";
        document.head.appendChild(styleEl);
    }

    // 모바일 ST에서 bottom 좌표가 깨지는 환경이 있어서, top 기반으로 계산
    // (높이 % → 픽셀로 변환하고, 위에서부터 위치 잡음)
    const buildPositionCSS = (pos, offsetX, offsetY, heightVh) => {
        // bottom 대신 top 사용: viewport 높이 - 컨테이너 높이 - offsetY = top 좌표
        const topCalc = `calc(100vh - ${heightVh}vh - ${offsetY}px)`;
        let css = `top: ${topCalc}; bottom: auto;`;
        if (pos === "bottom-left") {
            css += ` left: ${offsetX}px; right: auto; transform: none;`;
        } else if (pos === "bottom-right") {
            css += ` left: auto; right: ${offsetX}px; transform: none;`;
        } else if (pos === "bottom-center") {
            css += ` left: 50%; right: auto; transform: translateX(-50%);`;
        }
        return css;
    };

    const desktopPos = buildPositionCSS(
        settings.desktopPosition,
        settings.desktopOffsetX,
        settings.desktopOffsetY,
        settings.desktopHeight
    );
    const mobilePos = buildPositionCSS(
        settings.mobilePosition,
        settings.mobileOffsetX,
        settings.mobileOffsetY,
        settings.mobileHeight
    );

    styleEl.textContent = `
        #dynamic-sprite-container {
            ${desktopPos}
            height: ${settings.desktopHeight}vh;
            z-index: ${settings.desktopZIndex};
        }
        #dynamic-sprite-img {
            max-width: ${settings.desktopMaxWidth}px;
            opacity: ${settings.desktopOpacity / 100};
        }
        @media (max-width: ${settings.mobileBreakpoint}px) {
            #dynamic-sprite-container {
                ${mobilePos}
                height: ${settings.mobileHeight}vh;
                z-index: ${settings.mobileZIndex};
            }
            #dynamic-sprite-img {
                max-width: ${settings.mobileMaxWidth}px;
                opacity: ${settings.mobileOpacity / 100};
            }
        }
    `;
}

let currentBlobUrl = null;
async function updateSprite(emotionLabel) {
    const settings = extension_settings[extensionName];
    if (!settings.enabled || !settings.showSprite) return;

    const charName = getCurrentCharName();
    if (!charName) return;

    const charData = getCharData(charName);
    const preset = getActivePreset(charName);
    // 정확 매칭만 — 없으면 neutral fallback, 그것도 없으면 변경 안 함
    const emotion = preset.emotions.find(e => e.label === emotionLabel)
        || preset.emotions.find(e => e.label.toLowerCase() === "neutral");
    if (!emotion) {
        console.warn(`[DynamicSprite] "${emotionLabel}" 매칭 실패, 스프라이트 유지`);
        return;
    }

    const img = document.getElementById("dynamic-sprite-img");
    if (!img) return;

    try {
        const blob = await loadImage(emotion.imageKey);
        if (!blob) {
            console.warn(`[DynamicSprite] 이미지 blob 없음: ${emotion.imageKey}`);
            return;
        }

        // 모바일 여부에 따라 목표 opacity 결정
        const isMobile = window.innerWidth <= settings.mobileBreakpoint;
        const targetOpacity = (isMobile ? settings.mobileOpacity : settings.desktopOpacity) / 100;

        // 새 blob URL 만들기 (이미지 로드 완료 후 이전 거 해제)
        const newBlobUrl = URL.createObjectURL(blob);

        // 첫 표시인지 체크 (display none → block 전환)
        const isFirstShow = img.style.display === "none" || !img.src;

        if (isFirstShow) {
            // 첫 표시: opacity 0으로 시작 → src 설정 → fade-in
            img.style.transition = "none";
            img.style.opacity = "0";
            img.style.display = "block";

            img.onload = () => {
                requestAnimationFrame(() => {
                    img.style.transition = `opacity ${settings.transitionDuration}ms ease`;
                    img.style.opacity = String(targetOpacity);
                });
                if (currentBlobUrl && currentBlobUrl !== newBlobUrl) {
                    URL.revokeObjectURL(currentBlobUrl);
                }
                currentBlobUrl = newBlobUrl;
                img.onload = null;
            };
            img.onerror = () => {
                console.error(`[DynamicSprite] 이미지 표시 실패: ${emotion.label}`);
                URL.revokeObjectURL(newBlobUrl);
                img.onerror = null;
            };
            img.src = newBlobUrl;
        } else {
            // 전환: fade out → src 교체 → fade in
            img.style.transition = `opacity ${settings.transitionDuration}ms ease`;
            img.style.opacity = "0";

            setTimeout(() => {
                img.onload = () => {
                    img.style.opacity = String(targetOpacity);
                    if (currentBlobUrl && currentBlobUrl !== newBlobUrl) {
                        URL.revokeObjectURL(currentBlobUrl);
                    }
                    currentBlobUrl = newBlobUrl;
                    img.onload = null;
                };
                img.src = newBlobUrl;
            }, settings.transitionDuration);
        }

        preset.current = emotion.label;
        // 사용 횟수 카운트 (자동/수동 모두)
        emotion.usageCount = (emotion.usageCount || 0) + 1;
        emotion.lastUsedAt = Date.now();
        saveSettingsDebounced();
    } catch (err) {
        console.error("[DynamicSprite] 이미지 로드 실패:", err);
    }
}

// ====================================================================
// 프롬프트 빌더 - 캐릭터명 미포함 (배포용)
// ====================================================================
function buildEmotionPrompt(messageText, charData, customInstruction, relationContext) {
    const emotionDescriptions = charData.emotions.map(e => {
        return e.description?.trim()
            ? `- ${e.label}: ${e.description}`
            : `- ${e.label}`;
    }).join("\n");

    const contextBlock = [
        customInstruction ? `성격/분석 지침:\n${customInstruction}` : "",
        relationContext   ? `유저와의 관계:\n${relationContext}` : "",
    ].filter(Boolean).join("\n\n");

    return `[System Task: Emotion Classification]

You are classifying the dominant emotion shown by a character in a roleplay response. Read the text carefully and identify what the CHARACTER is INTERNALLY feeling — not what they say, not what the user is doing.

[Character's response]
${messageText}

[Available emotion labels - choose ONE]
${emotionDescriptions}

${contextBlock ? `[Character traits / context]\n${contextBlock}\n\n` : ""}[Classification guidelines]
- Default to "neutral" for ordinary conversation, small talk, factual statements, or mild responses without clear emotional signals. Most everyday dialogue is neutral.
- Only pick a strong emotion (positive OR negative) when the text contains clear, explicit signals: emotional words, tone markers, body language descriptions, or unmistakable context.
- Treat positive and negative emotions with equal weight. Do NOT default toward negative labels (guarded, contempt, aloof, tired, etc.) just because the tone is calm or reserved. Calm ≠ negative.
- "guarded", "contempt", "aloof", "disdain" require explicit hostility, suspicion, or dismissiveness in the text — not just absence of warmth.
- "smile", "amused", "happy" require explicit positive signals — warmth, laughter, fondness, playfulness, soft tone toward the other person.
- If the character is making casual conversation, asking questions, or giving information without emotional charge → "neutral".
- If genuinely ambiguous between two emotions, prefer the milder/more neutral one.
- Do NOT assign a label just because that word appears in the text. e.g. "you're laughing at me" or "I hate it when you do that (jokingly)" — the character is not necessarily laughing or angry. Focus on the character's own internal state.
- Output ONLY the label name. No quotes, no markdown, no explanation, no punctuation.

Label:`;
}

// ====================================================================
// NovelAI 이미지 생성 호출
// ====================================================================
async function callNovelAI(prompt, negativePrompt, config) {
    const model = (config.model ?? "nai-diffusion-4-5-full").trim();
    if (!model) throw new Error("직접 사용할 모델 ID를 입력하세요.");
    const seed = (config.seedLocked && config.lockedSeed >= 0)
        ? config.lockedSeed
        : Math.floor(Math.random() * 4294967295);

    const body = {
        input: prompt,
        model,
        action: "generate",
        parameters: {
            params_version: 3,
            width: config.width || 832,
            height: config.height || 1216,
            scale: config.scale || 5,
            cfg_rescale: config.cfgRescale ?? 0,
            sampler: config.sampler || "k_euler_ancestral",
            steps: config.steps || 28,
            seed: seed,
            n_samples: 1,
            ucPreset: 0,
            qualityToggle: true,
            negative_prompt: negativePrompt || "",
            characterPrompts: [],
            v4_prompt: {
                caption: { base_caption: prompt, char_captions: [] },
                use_coords: false,
                use_order: true
            },
            v4_negative_prompt: {
                caption: { base_caption: negativePrompt || "", char_captions: [] }
            }
        }
    };

    const blob = await requestNaiImage(body, config, extension_settings.sharednai_bridge, {
        getRequestHeaders,
        extractZip: extractImageFromNaiZip,
    });
    return { blob, seed };
}

async function callNovelAIWithRetry(prompt, negativePrompt, config, { maxRetries = 4, baseDelay = 8000 } = {}) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await callNovelAI(prompt, negativePrompt, config);
        } catch (err) {
            const is429 = err.status === 429;
            if (is429 && attempt < maxRetries) {
                const wait = baseDelay * (attempt + 1); // 8s, 16s, 24s, 32s
                console.log(`[NAI] 429 — ${wait / 1000}초 후 재시도 (${attempt + 1}/${maxRetries})`);
                toastr.info(`NAI 락 — ${wait / 1000}초 후 재시도 (${attempt + 1}/${maxRetries})`, "", { timeOut: wait });
                await new Promise(r => setTimeout(r, wait));
            } else {
                throw err;
            }
        }
    }
}

// ====================================================================
// NAI 표정 생성 유틸
// ====================================================================
const DEFAULT_LABEL_PROMPTS = {
    neutral:      "::calm face::, relaxed, looking at viewer",
    smile:        "::gentle smile::, warm look, looking at viewer",
    happy:        "::bright smile::, ::joyful::, looking at viewer",
    amused:       "::amused::, slight smile, eyes narrowed playfully",
    sad:          "::downcast eyes::, ::slight frown::, melancholic",
    angry:        "::furrowed brows::, ::intense glare::, furious",
    surprised:    "::wide eyes::, ::slightly open mouth::, shocked",
    afraid:       "::wide eyes::, trembling, tense, scared",
    disgust:      "::slight frown::, ::narrowed eyes::, repulsed",
    contempt:     "::sneering::, cold gaze, looking to the side",
    smirk:        "::half smile::, raised eyebrow, confident",
    tired:        "::half-lidded eyes::, exhausted, sleepy",
    aloof:        "::cold face::, distant gaze, looking away",
    embarrassed:  "::blushing::, looking away, flustered",
    confused:     "::slight frown::, head tilted, puzzled",
    pain:         "::gritted teeth::, ::eyes closed tightly::, agonized",
    love:         "::soft smile::, ::blushing::, adoring look",
    determined:   "::focused::, serious, resolute gaze",
    crying:       "::tears streaming down face::, ::sobbing::, red eyes, sad expression",
    laughing:     "::wide smile::, ::eyes closed from laughter::, delighted",
    bored:        "::bored::, unimpressed, flat look, listless",
    shocked:      "::wide eyes::, ::mouth agape::, startled",
    nervous:      "::nervous::, anxious expression, fidgety, uneasy",
    excited:      "::bright eyes::, eager smile, energetic",
    calm:         "::serene::, composed, relaxed face",
    pensive:      "::thoughtful::, gazing into distance",
    proud:        "::confident smile::, chin up",
    worried:      "::furrowed brows::, anxious gaze",
    shy:          "::blushing::, eyes averted, reserved",
    playful:      "::mischievous grin::, bright eyes",
    hurt:         "::pained eyes::, quivering lip, wounded",
    suspicious:   "::narrowed eyes::, skeptical look",
    disappointed: "::downcast::, dejected",
    cold:         "::icy glare::, detached",
    gentle:       "::soft eyes::, warm and caring look",
};

function buildNaiPrompt(charName, label) {
    const cfg = extension_settings[extensionName];
    const charData = getCharData(charName);
    const naiGen = charData.naiGen || {};
    const style    = (cfg.naiConfig?.stylePrompt  || "").trim();
    const base     = (naiGen.basePrompt || "").trim();
    const intensity = cfg.naiConfig?.labelIntensity ?? 2;
    const defaultDesc = DEFAULT_LABEL_PROMPTS[label];
    const labelExtra = (
        naiGen.labelPrompts?.[label] ||
        (defaultDesc ? `${intensity}::${label}::, ${defaultDesc}` : null) ||
        `${intensity}::${label}::`
    ).trim();
    const styleNeg = (cfg.naiConfig?.styleNegPrompt || "").trim();
    const charNeg  = (naiGen.negativePrompt || "").trim();
    const defaultNeg = "lowres, bad anatomy, bad hands, text, error, extra digit, worst quality, low quality";
    const parts = [style, base, labelExtra].filter(Boolean);
    const negParts = [styleNeg, charNeg || defaultNeg].filter(Boolean);
    return { prompt: parts.join(", "), negativePrompt: negParts.join(", ") };
}

let naiGenerating = false;

async function generateSpriteForLabel(charName, label) {
    if (naiGenerating) {
        toastr.warning("이미 생성 중입니다. 완료 후 시도하세요.");
        return false;
    }
    naiGenerating = true;
    try {
        const { prompt, negativePrompt } = buildNaiPrompt(charName, label);
        if (!prompt) throw new Error("베이스 프롬프트를 먼저 입력하세요.");
        const { blob, seed: usedSeed } = await callNovelAIWithRetry(prompt, negativePrompt, extension_settings[extensionName].naiConfig);
        const naiCfg = extension_settings[extensionName].naiConfig;
        const finalBlob = naiCfg.autoRemoveBg
            ? await removeWhiteBackground(blob, naiCfg.removeBgThreshold ?? 240)
            : blob;
        const file = new File([finalBlob], `${label}.png`, { type: "image/png" });
        await addEmotion(file, label, charName);
        return usedSeed;
    } catch (err) {
        console.error(`[NAI Gen] ${label} 실패:`, err);
        throw err;
    } finally {
        naiGenerating = false;
    }
}

// ====================================================================
// 감정 라벨 매칭 단계 — 새 단계 추가하려면 MATCHERS 배열에 함수 하나 추가
// 각 matcher는 (rawText, preset) → emotion | null  순수 함수
// ====================================================================
function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 1차: 정확 매칭 — 응답을 cleaned 후 라벨과 직접 비교
function matchExact(rawText, preset) {
    const cleaned = rawText.toLowerCase().replace(/[*_`"'.\s,!?]+/g, "");
    return preset.emotions.find(e => e.label.toLowerCase() === cleaned) || null;
}

// 2차: 첫 단어만 추출 — LLM이 가끔 문장으로 답할 때
function matchFirstWord(rawText, preset) {
    const firstWord = rawText.split(/[\s,.\n]+/)[0].toLowerCase().replace(/[*_`"'.,!?]/g, "");
    return preset.emotions.find(e => e.label.toLowerCase() === firstWord) || null;
}

// 3차: 단어 경계 부분 매칭 — 라벨이 문장 안에 정확히 포함
function matchPartial(rawText, preset) {
    const lowerText = rawText.toLowerCase();
    return preset.emotions.find(e => {
        const regex = new RegExp(`\\b${escapeRegex(e.label.toLowerCase())}\\b`);
        return regex.test(lowerText);
    }) || null;
}

// 4차: alias 매핑 — AI가 다른 단어를 뱉었을 때 canonical 라벨로 매핑
function matchAlias(rawText, preset) {
    const aliases = getEmotionAliases();
    const lowerText = rawText.toLowerCase();
    for (const aliasWord in aliases) {
        if (!new RegExp(`\\b${escapeRegex(aliasWord)}\\b`).test(lowerText)) continue;
        const canonical = aliases[aliasWord];
        // canonical 라벨 직접 등록
        let m = preset.emotions.find(e => e.label.toLowerCase() === canonical);
        if (m) {
            console.log(`[DynamicSprite] alias 매핑: "${aliasWord}" → "${canonical}"`);
            return m;
        }
        // 같은 그룹의 다른 alias도 시도
        for (const w in aliases) {
            if (aliases[w] !== canonical || w === aliasWord) continue;
            m = preset.emotions.find(e => e.label.toLowerCase() === w);
            if (m) {
                console.log(`[DynamicSprite] alias 그룹 매핑: "${aliasWord}" → "${w}"`);
                return m;
            }
        }
    }
    return null;
}

const MATCHERS = [matchExact, matchFirstWord, matchPartial, matchAlias];

function matchEmotionLabel(rawText, preset) {
    for (const m of MATCHERS) {
        const hit = m(rawText, preset);
        if (hit) return hit;
    }
    return null;
}

// ====================================================================
// 분석 캐시 (메모리) — 같은 메시지 재분석 시 API 호출 안 함
// ====================================================================
const analysisCache = new Map(); // key: charName::messageHash → label
const ANALYSIS_CACHE_MAX = 200;

function simpleHash(str) {
    // 빠른 해시 (FNV-1a 변형)
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
}

function cacheGet(charName, messageText) {
    const key = `${charName}::${simpleHash(messageText)}`;
    return analysisCache.get(key) || null;
}

function cacheSet(charName, messageText, label) {
    if (analysisCache.size >= ANALYSIS_CACHE_MAX) {
        // FIFO 정리 - 가장 오래된 절반 제거
        const keys = [...analysisCache.keys()];
        for (let i = 0; i < keys.length / 2; i++) analysisCache.delete(keys[i]);
    }
    const key = `${charName}::${simpleHash(messageText)}`;
    analysisCache.set(key, label);
}

// ====================================================================
// 감정 분석 통합 라우터
// ====================================================================
async function analyzeEmotion(messageText) {
    const settings = extension_settings[extensionName];
    const charName = getCurrentCharName();
    if (!charName) return null;

    const charData = getCharData(charName);
    const preset = getActivePreset(charName);
    if (preset.emotions.length === 0) return null;

    // 캐시 확인
    const cached = cacheGet(charName, messageText);
    if (cached) {
        // 캐시에 있는 라벨이 아직 등록된 라벨인지도 확인
        const stillExists = preset.emotions.some(e => e.label === cached);
        if (stillExists) {
            console.log(`[DynamicSprite] (cache) → ${cached}`);
            return cached;
        }
    }

    const prompt = buildEmotionPrompt(
        messageText, preset,
        settings.customPrompt?.trim() || "",
        settings.relationContext?.trim() || ""
    );

    try {
        const startTime = performance.now();
        const result = await callAnalysisProvider(prompt);
        const elapsed = Math.round(performance.now() - startTime);
        const rawText = result.trim();

        const matched = matchEmotionLabel(rawText, preset);

        if (!matched) {
            // 매칭 실패 → null 반환 = 스프라이트 유지
            console.warn(`[DynamicSprite] (${settings.apiMode}, ${elapsed}ms) 매칭 실패: "${rawText}" → 스프라이트 유지`);
            return null;
        }

        console.log(`[DynamicSprite] (${settings.apiMode}, ${elapsed}ms) "${rawText}" → ${matched.label}`);
        cacheSet(charName, messageText, matched.label);
        return matched.label;
    } catch (err) {
        console.error("[DynamicSprite] 감정 분석 실패:", err);
        toastr.error(`감정 분석 실패: ${err.message}`, "Dynamic Sprite", { timeOut: 5000 });
        return null; // 실패 시에도 스프라이트 유지
    }
}

// ====================================================================
// 감정 별칭 (alias) — 같은 의미의 다른 단어를 canonical 라벨로 매핑
// AI가 등록된 라벨과 다른 단어를 뱉어도 매칭되게 함
// ====================================================================
const BUILTIN_ALIASES = {
    // happy/joy 계열
    happy: "happy", joy: "happy", joyful: "happy", glad: "happy", cheerful: "happy", delighted: "happy", elated: "happy",
    // smile 계열
    smile: "smile", smiling: "smile", grin: "smile", grinning: "smile",
    // amused 계열
    amused: "amused", entertained: "amused", chuckling: "amused", laughing: "amused",
    // sad 계열
    sad: "sad", sorrow: "sad", sorrowful: "sad", unhappy: "sad", melancholy: "sad", gloomy: "sad", depressed: "sad",
    // angry 계열
    angry: "angry", furious: "angry", mad: "angry", enraged: "angry", irritated: "angry", annoyed: "angry", irate: "angry",
    // surprised 계열
    surprised: "surprised", shocked: "surprised", astonished: "surprised", startled: "surprised", caught_off_guard: "surprised", caught: "surprised",
    // fear 계열
    afraid: "afraid", scared: "afraid", fearful: "afraid", terrified: "afraid", anxious: "afraid", nervous: "afraid",
    // disgust 계열
    disgusted: "disgust", disgust: "disgust", revolted: "disgust", repulsed: "disgust",
    // contempt 계열
    contempt: "contempt", contemptuous: "contempt", scornful: "contempt", disdainful: "contempt", disdain: "contempt",
    // smirk 계열
    smirk: "smirk", smirking: "smirk", slight_smirk: "smirk", smug: "smirk",
    // tired 계열
    tired: "tired", exhausted: "tired", weary: "tired", fatigued: "tired", worn_out: "tired", worn: "tired",
    // neutral 계열
    neutral: "neutral", blank: "neutral", emotionless: "neutral", expressionless: "neutral",
    // aloof/cold 계열
    aloof: "aloof", distant: "aloof", cold: "aloof", detached: "aloof", reserved: "aloof",
    // guarded 계열
    guarded: "guarded", wary: "guarded", cautious: "guarded", suspicious: "guarded",
    // calculating 계열
    calculating: "calculating", thoughtful: "calculating", scheming: "calculating", pondering: "calculating",
    // embarrassed 계열
    embarrassed: "embarrassed", flustered: "embarrassed", abashed: "embarrassed", bashful: "embarrassed",
    // confused 계열
    confused: "confused", puzzled: "confused", perplexed: "confused", bewildered: "confused",
    // pain 계열
    pain: "pain", hurt: "pain", suffering: "pain", agony: "pain",
    // love/affection 계열
    love: "love", loving: "love", affectionate: "love", fond: "love", tender: "love",
    // determined 계열
    determined: "determined", resolute: "determined", focused: "determined", serious: "determined",
};

// 사용자 정의 alias와 빌트인 alias 병합 (사용자 정의 우선)
function getEmotionAliases() {
    const settings = extension_settings[extensionName];
    const userAliases = settings.userAliases || {};
    return { ...BUILTIN_ALIASES, ...userAliases };
}

// ====================================================================
// 메시지 수신 핸들러
// ====================================================================
let processing = false;
async function onMessageReceived(messageId) {
    const settings = extension_settings[extensionName];
    if (!settings.enabled || processing) return;

    const context = getContext();
    const message = context.chat?.[messageId];
    if (!message || message.is_user || message.is_system) return;
    if (!message.mes || message.mes.trim().length < 5) return;

    processing = true;
    try {
        const emotion = await analyzeEmotion(message.mes);
        if (emotion) await updateSprite(emotion);
    } finally {
        processing = false;
    }
}

// ====================================================================
// 감정 추가 (개별 파일)
// ====================================================================
async function addEmotion(file, customLabel = null, targetCharName = null) {
    const charName = targetCharName || getCurrentCharName();
    if (!charName) {
        toastr.warning("먼저 캐릭터를 선택하세요");
        return null;
    }

    const settings = extension_settings[extensionName];
    const charData = getCharData(charName);
    const preset = getActivePreset(charName);
    const label = customLabel || extractEmotionFromFilename(file.name);

    // 자동 압축 적용
    let processedFile = file;
    if (settings.autoCompress !== false) {
        try {
            const maxDim = settings.compressMaxDim || 800;
            const quality = (settings.compressQuality || 85) / 100;
            processedFile = await compressImage(file, maxDim, quality);
        } catch (err) {
            console.warn("[DynamicSprite] 압축 실패, 원본 사용:", err);
            processedFile = file;
        }
    }

    const existing = preset.emotions.find(e => e.label === label);
    if (existing) {
        // 폴더 일괄 등록 시엔 confirm 생략, 자동 덮어쓰기
        await deleteImage(existing.imageKey);
        if (settings.imageBackup) delete settings.imageBackup[existing.imageKey];
        preset.emotions = preset.emotions.filter(e => e.label !== label);
    }

    const imageKey = `${charName}__${label}__${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await saveImage(imageKey, processedFile);

    // 자동 백업 - settings에 base64로 저장해서 origin 바뀌어도 복원 가능
    if (settings.autoBackup) {
        try {
            const base64 = await blobToBase64(processedFile);
            settings.imageBackup = settings.imageBackup || {};
            settings.imageBackup[imageKey] = base64;
        } catch (err) {
            console.warn("[DynamicSprite] 자동 백업 실패:", err);
        }
    }

    preset.emotions.push({
        label, imageKey, description: "", addedAt: Date.now(),
        usageCount: 0
    });

    saveSettingsDebounced();
    return label;
}

// ====================================================================
// 캐릭터의 모든 감정 일괄 삭제
// ====================================================================
async function deleteAllEmotionsForChar(charName) {
    const settings = extension_settings[extensionName];
    const charData = settings.characters[charName];
    if (!charData) return 0;
    const preset = getActivePreset(charName);
    if (!preset || preset.emotions.length === 0) return 0;

    const count = preset.emotions.length;
    for (const emotion of preset.emotions) {
        try {
            await deleteImage(emotion.imageKey);
            if (settings.imageBackup) delete settings.imageBackup[emotion.imageKey];
        } catch (err) {
            console.warn(`[DynamicSprite] 삭제 실패: ${emotion.imageKey}`, err);
        }
    }
    preset.emotions = [];
    preset.current = null;
    saveSettingsDebounced();
    return count;
}

// ====================================================================
// 전체 감정 데이터 일괄 삭제 (모든 캐릭터)
// ====================================================================
async function deleteAllEmotionsEverywhere() {
    const settings = extension_settings[extensionName];
    let total = 0;
    for (const charName in settings.characters) {
        const cd = settings.characters[charName];
        for (const pName in cd.presets || {}) {
            for (const emotion of cd.presets[pName].emotions) {
                try {
                    await deleteImage(emotion.imageKey);
                    if (settings.imageBackup) delete settings.imageBackup[emotion.imageKey];
                    total++;
                } catch {}
            }
        }
    }
    settings.characters = {};
    settings.imageBackup = {};
    saveSettingsDebounced();
    return total;
}

// ====================================================================
// 자동 복구 - IndexedDB가 비어있는데 백업은 있는 경우
// (origin이 바뀌어서 IndexedDB가 격리된 상황 자동 감지)
// ====================================================================
async function autoRestoreFromBackup() {
    const settings = extension_settings[extensionName];
    if (!settings.imageBackup || Object.keys(settings.imageBackup).length === 0) return 0;

    // 등록된 imageKey들 모음
    const expectedKeys = new Set();
    for (const charName in settings.characters) {
        const cd = settings.characters[charName];
        for (const presetName in cd.presets || {}) {
            for (const emotion of cd.presets[presetName].emotions) {
                expectedKeys.add(emotion.imageKey);
            }
        }
    }
    if (expectedKeys.size === 0) return 0;

    // IndexedDB에 실제 존재하는 키 확인
    let existingCount = 0;
    for (const key of expectedKeys) {
        try {
            const blob = await loadImage(key);
            if (blob) existingCount++;
        } catch {}
    }

    // 전부 다 있으면 복구 불필요
    if (existingCount === expectedKeys.size) return 0;

    // 누락된 거 복구
    let restored = 0;
    for (const key of expectedKeys) {
        try {
            const blob = await loadImage(key);
            if (!blob && settings.imageBackup[key]) {
                const restoredBlob = await base64ToBlob(settings.imageBackup[key]);
                await saveImage(key, restoredBlob);
                restored++;
            }
        } catch (err) {
            console.warn(`[DynamicSprite] 복원 실패: ${key}`, err);
        }
    }
    return restored;
}

// ====================================================================
// 폴더 통째 업로드 - webkitdirectory 사용
// ====================================================================
async function handleFolderUpload(files) {
    const charName = getCurrentCharName();
    if (!charName) {
        toastr.warning("먼저 캐릭터를 선택하세요");
        return;
    }

    // 이미지 파일만 필터링
    const imageFiles = files.filter(f =>
        /\.(png|jpg|jpeg|webp|gif)$/i.test(f.name)
    );

    if (imageFiles.length === 0) {
        toastr.warning("이미지 파일이 없습니다");
        return;
    }

    const status = $("#ds-upload-status");
    const results = [];

    for (let i = 0; i < imageFiles.length; i++) {
        const file = imageFiles[i];
        status.html(`📁 폴더 처리 중... (${i + 1}/${imageFiles.length}) - ${file.name}`);

        try {
            const label = await addEmotion(file);
            if (label) results.push(`✅ <b>${label}</b>`);
        } catch (err) {
            results.push(`❌ ${file.name}`);
        }
    }

    status.html(`완료: ${imageFiles.length}개 처리됨<br>${results.join(" ")}`);
    renderEmotionList();
}

// ====================================================================
// 감정 리스트 - 아코디언 형태로 렌더링
// ====================================================================
function renderEmotionList() {
    const listEl = document.getElementById("ds-emotion-list");
    if (!listEl) return;

    const settings = extension_settings[extensionName];
    const allChars = Object.keys(settings.characters).filter(name => {
        const cd = getCharData(name); // 마이그레이션 트리거
        return cd.presets && Object.values(cd.presets).some(p => p.emotions.length > 0);
    });

    const currentChar = getCurrentCharName();

    // 현재 캐릭터 헤더
    const currentCharEl = document.getElementById("ds-current-char");
    if (currentCharEl) {
        currentCharEl.textContent = currentChar || "(선택 안 됨)";
    }

    if (allChars.length === 0) {
        listEl.innerHTML = "<div class='ds-empty'>아직 등록된 감정이 없습니다.<br>아래에서 이미지를 추가하세요 ↓</div>";
        return;
    }

    // 현재 캐릭터를 맨 위로
    const sortedChars = [
        ...(currentChar && allChars.includes(currentChar) ? [currentChar] : []),
        ...allChars.filter(c => c !== currentChar).sort()
    ];

    listEl.innerHTML = "";

    sortedChars.forEach(charName => {
        const charData = getCharData(charName); // 마이그레이션 보장
        const isExpanded = settings.expandedChars[charName] || charName === currentChar;
        const isCurrent = charName === currentChar;

        const preset = getActivePreset(charName);
        const presetNames = Object.keys(charData.presets);

        const accordion = document.createElement("div");
        accordion.className = `ds-char-accordion ${isCurrent ? "ds-current" : ""}`;

        const presetTabsHtml = presetNames.map(pName => `
            <button class="ds-preset-tab${pName === charData.activePreset ? " ds-preset-tab-active" : ""}"
                data-char="${charName}" data-preset="${pName}">${pName}${presetNames.length > 1
                    ? `<span class="ds-preset-del" data-char="${charName}" data-preset="${pName}">×</span>`
                    : ""}</button>
        `).join("");

        accordion.innerHTML = `
            <div class="ds-char-header" data-char="${charName}">
                <span class="ds-char-toggle">${isExpanded ? "▼" : "▶"}</span>
                <span class="ds-char-name">${isCurrent ? "🎯 " : ""}${charName}</span>
                <span class="ds-char-count">${preset.emotions.length}개</span>
            </div>
            <div class="ds-char-body" style="display:${isExpanded ? "block" : "none"};">
                <div class="ds-preset-bar">
                    ${presetTabsHtml}
                    <button class="ds-preset-add" data-char="${charName}" title="새 프리셋">＋</button>
                </div>
            </div>
        `;

        const body = accordion.querySelector(".ds-char-body");

        preset.emotions.forEach((emotion, idx) => {
            const item = document.createElement("div");
            item.className = "ds-emotion-item";
            const usage = emotion.usageCount || 0;
            const usageBadge = usage > 0
                ? `<span class="ds-usage-badge" title="사용 횟수">×${usage}</span>`
                : `<span class="ds-usage-badge ds-usage-zero" title="한 번도 안 쓰임">×0</span>`;
            const groupsValue = Array.isArray(emotion.groups) ? emotion.groups.join(", ") : "";
            item.innerHTML = `
                <img class="ds-thumb" alt="${emotion.label}">
                <div class="ds-emotion-info">
                    <div class="ds-emotion-label-row">
                        <input type="text" class="ds-emotion-label text_pole"
                            value="${emotion.label}" data-char="${charName}" data-idx="${idx}">
                        ${usageBadge}
                    </div>
                    <textarea class="ds-emotion-desc text_pole" rows="2"
                        placeholder="설명 (선택) - 예: 차갑게 비웃는 표정"
                        data-char="${charName}" data-idx="${idx}">${emotion.description || ""}</textarea>
                    <input type="text" class="ds-emotion-groups text_pole"
                        placeholder="그룹/태그 (쉼표 구분, 선택) - 예: 긍정, 차분"
                        value="${groupsValue}" data-char="${charName}" data-idx="${idx}"
                        style="font-size:0.82em; margin-top:2px;">
                </div>
                <div class="ds-emotion-actions">
                    <button class="menu_button ds-nai-gen-one" data-char="${charName}" data-label="${emotion.label}" title="NAI로 이미지 생성">AI</button>
                    <button class="menu_button ds-delete-btn" data-char="${charName}" data-idx="${idx}" title="삭제">삭제</button>
                </div>
            `;
            body.appendChild(item);

            loadImage(emotion.imageKey).then(blob => {
                if (blob) {
                    const url = URL.createObjectURL(blob);
                    item.querySelector(".ds-thumb").src = url;
                }
            });
        });

        listEl.appendChild(accordion);
    });

    // 헤더 클릭 → 펼치기/접기
    listEl.querySelectorAll(".ds-char-header").forEach(header => {
        header.addEventListener("click", (e) => {
            const charName = e.currentTarget.dataset.char;
            const body = e.currentTarget.nextElementSibling;
            const toggle = e.currentTarget.querySelector(".ds-char-toggle");
            const isExpanded = body.style.display !== "none";

            body.style.display = isExpanded ? "none" : "block";
            toggle.textContent = isExpanded ? "▶" : "▼";
            settings.expandedChars[charName] = !isExpanded;
            saveSettingsDebounced();
        });
    });

    // 프리셋 탭 전환
    listEl.querySelectorAll(".ds-preset-tab").forEach(btn => {
        btn.addEventListener("click", (e) => {
            if (e.target.classList.contains("ds-preset-del")) return;
            const cn = e.currentTarget.dataset.char;
            const pName = e.currentTarget.dataset.preset;
            settings.characters[cn].activePreset = pName;
            saveSettingsDebounced();
            renderEmotionList();
        });
    });

    // 프리셋 삭제 (× 버튼)
    listEl.querySelectorAll(".ds-preset-del").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const cn = e.currentTarget.dataset.char;
            const pName = e.currentTarget.dataset.preset;
            const cd = settings.characters[cn];
            if (Object.keys(cd.presets).length <= 1) return;
            if (!confirm(`"${pName}" 프리셋과 감정 ${cd.presets[pName].emotions.length}개를 삭제할까요?`)) return;
            for (const em of cd.presets[pName].emotions) {
                deleteImage(em.imageKey).catch(() => {});
                if (settings.imageBackup) delete settings.imageBackup[em.imageKey];
            }
            delete cd.presets[pName];
            if (cd.activePreset === pName) cd.activePreset = Object.keys(cd.presets)[0];
            saveSettingsDebounced();
            renderEmotionList();
        });
    });

    // 새 프리셋 추가
    listEl.querySelectorAll(".ds-preset-add").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const cn = e.currentTarget.dataset.char;
            const name = prompt("새 프리셋 이름:", "");
            if (!name?.trim()) return;
            const cd = settings.characters[cn];
            if (cd.presets[name.trim()]) { alert("같은 이름이 이미 있습니다"); return; }
            cd.presets[name.trim()] = { emotions: [], current: null };
            cd.activePreset = name.trim();
            saveSettingsDebounced();
            renderEmotionList();
        });
    });

    // 라벨 수정
    listEl.querySelectorAll(".ds-emotion-label").forEach(input => {
        input.addEventListener("change", (e) => {
            const cn = e.target.dataset.char;
            const idx = parseInt(e.target.dataset.idx);
            getActivePreset(cn).emotions[idx].label = e.target.value.trim();
            saveSettingsDebounced();
        });
    });

    // 설명 수정
    listEl.querySelectorAll(".ds-emotion-desc").forEach(input => {
        input.addEventListener("change", (e) => {
            const cn = e.target.dataset.char;
            const idx = parseInt(e.target.dataset.idx);
            getActivePreset(cn).emotions[idx].description = e.target.value.trim();
            saveSettingsDebounced();
        });
    });

    // 그룹/태그 수정
    listEl.querySelectorAll(".ds-emotion-groups").forEach(input => {
        input.addEventListener("change", (e) => {
            const cn = e.target.dataset.char;
            const idx = parseInt(e.target.dataset.idx);
            const groups = e.target.value
                .split(",")
                .map(s => s.trim())
                .filter(s => s.length > 0);
            getActivePreset(cn).emotions[idx].groups = groups;
            saveSettingsDebounced();
        });
    });

    // 삭제
    listEl.querySelectorAll(".ds-delete-btn").forEach(btn => {
        btn.addEventListener("click", async (e) => {
            const cn = e.currentTarget.dataset.char;
            const idx = parseInt(e.currentTarget.dataset.idx);
            const emotion = getActivePreset(cn).emotions[idx];
            if (!confirm(`"${emotion.label}" 감정을 삭제할까요?`)) return;
            await deleteImage(emotion.imageKey);
            if (settings.imageBackup) delete settings.imageBackup[emotion.imageKey];
            getActivePreset(cn).emotions.splice(idx, 1);
            saveSettingsDebounced();
            renderEmotionList();
        });
    });

    // NAI 단일 생성
    listEl.querySelectorAll(".ds-nai-gen-one").forEach(btn => {
        btn.addEventListener("click", async (e) => {
            const cn = e.currentTarget.dataset.char;
            const label = e.currentTarget.dataset.label;
            if (!hasImageConnection(settings.naiConfig, extension_settings.sharednai_bridge)) {
                toastr.warning("NAI API 키를 입력하거나 SharedNAI 연결을 활성화하세요.");
                return;
            }
            const orig = btn.textContent;
            btn.disabled = true;
            btn.textContent = "⏳";
            try {
                await generateSpriteForLabel(cn, label);
                renderEmotionList();
                toastr.success(`"${label}" 생성 완료`);
            } catch (err) {
                toastr.error(`생성 실패: ${err.message}`);
                btn.disabled = false;
                btn.textContent = orig;
            }
        });
    });
}

// ====================================================================
// API 모드별 UI 표시/숨김
// ====================================================================
function updateApiFieldsVisibility() {
    const settings = extension_settings[extensionName];
    const mode = settings.apiMode;

    const stHint = document.getElementById("ds-api-st-hint");
    const profileField = document.getElementById("ds-api-profile-field");
    const keyField = document.getElementById("ds-api-key-field");
    const endpointField = document.getElementById("ds-api-endpoint-field");
    const modelField = document.getElementById("ds-api-model-field");
    const presetsField = document.getElementById("ds-api-presets-field");

    if (!stHint) return;

    // 모두 숨김
    stHint.style.display = "none";
    profileField.style.display = "none";
    keyField.style.display = "none";
    endpointField.style.display = "none";
    modelField.style.display = "none";
    presetsField.style.display = "none";

    if (mode === "st") {
        stHint.style.display = "block";
    } else if (mode === "st_profile") {
        profileField.style.display = "block";
        renderProfileDropdown();
    } else if (mode === "gemini") {
        keyField.style.display = "block";
        modelField.style.display = "block";
        document.getElementById("ds-api-key-label").textContent = "Gemini API 키";
        document.getElementById("ds-api-model-label").textContent = "모델명 (예: gemini-2.5-flash, gemini-2.0-flash)";
    } else if (mode === "openai_compat") {
        keyField.style.display = "block";
        endpointField.style.display = "block";
        modelField.style.display = "block";
        presetsField.style.display = "block";
        document.getElementById("ds-api-key-label").textContent = "API 키 (필요시)";
        document.getElementById("ds-api-model-label").textContent = "모델명 (예: deepseek-chat, google/gemini-2.5-flash 등)";
        renderPresets();
    }
}

function renderProfileDropdown() {
    const settings = extension_settings[extensionName];
    const select = document.getElementById("ds-api-profile");
    if (!select) return;

    const profiles = getSTProfiles();

    if (profiles.length === 0) {
        select.innerHTML = `<option value="">⚠️ ST에 등록된 Connection Profile 없음</option>`;
        return;
    }

    select.innerHTML = `<option value="">-- 프로필 선택 --</option>` +
        profiles.map(name =>
            `<option value="${name}" ${name === settings.apiProfile ? "selected" : ""}>${name}</option>`
        ).join("");
}

function renderPresets() {
    const container = document.getElementById("ds-api-presets");
    if (!container) return;

    const presets = [
        { name: "OpenRouter", endpoint: "https://openrouter.ai/api/v1" },
        { name: "OpenAI", endpoint: "https://api.openai.com/v1" },
        { name: "Groq", endpoint: "https://api.groq.com/openai/v1" },
        { name: "DeepSeek", endpoint: "https://api.deepseek.com/v1" }
    ];

    container.innerHTML = presets.map(p =>
        `<button class="menu_button ds-preset-btn" data-endpoint="${p.endpoint}">${p.name}</button>`
    ).join("");

    container.querySelectorAll(".ds-preset-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const endpoint = e.currentTarget.dataset.endpoint;
            document.getElementById("ds-api-endpoint").value = endpoint;
            extension_settings[extensionName].apiEndpoint = endpoint;
            saveSettingsDebounced();
        });
    });
}

// ====================================================================
// 설정 패널
// ====================================================================
function createSettingsPanel() {
    const settings = extension_settings[extensionName];

    const html = buildPanelHtml(settings);

    $("#extensions_settings").append(html);

    // 리스트 네비게이션 버튼 — append 직후 직접 바인딩
    document.getElementById("ds-list-up").addEventListener("click", () => {
        const el = document.getElementById("ds-emotion-list");
        if (el) el.scrollTop = Math.max(0, el.scrollTop - 280);
    });
    document.getElementById("ds-list-down").addEventListener("click", () => {
        const el = document.getElementById("ds-emotion-list");
        if (el) el.scrollTop = Math.min(el.scrollHeight, el.scrollTop + 280);
    });

    // === 이벤트 바인딩 ===

    // === 기본 토글 / 입력 ===
    bindSetting("ds-enabled", "enabled");
    bindSetting("ds-show-sprite", "showSprite", {
        onInput: (v) => {
            const container = document.getElementById("dynamic-sprite-container");
            if (container) container.style.display = v ? "flex" : "none";
        }
    });
    bindSetting("ds-transition", "transitionDuration", {
        parser: (raw) => parseInt(raw) || 300
    });

    $(document).on("click", "#dynamic-sprites-settings .ds-theme-btn", function () {
        settings.theme = this.dataset.theme;
        applyTheme();
        saveSettingsDebounced();
    });

    // === 표시 설정 (데스크탑 / 모바일) ===
    const displaySliders = [
        ["ds-desktop-offset-x",  "ds-desktop-offset-x-val",  "desktopOffsetX"],
        ["ds-desktop-offset-y",  "ds-desktop-offset-y-val",  "desktopOffsetY"],
        ["ds-desktop-height",    "ds-desktop-height-val",    "desktopHeight"],
        ["ds-desktop-maxwidth",  "ds-desktop-maxwidth-val",  "desktopMaxWidth"],
        ["ds-desktop-opacity",   "ds-desktop-opacity-val",   "desktopOpacity"],
        ["ds-desktop-zindex",    "ds-desktop-zindex-val",    "desktopZIndex"],
        ["ds-mobile-breakpoint", "ds-mobile-breakpoint-val", "mobileBreakpoint"],
        ["ds-mobile-offset-x",   "ds-mobile-offset-x-val",   "mobileOffsetX"],
        ["ds-mobile-offset-y",   "ds-mobile-offset-y-val",   "mobileOffsetY"],
        ["ds-mobile-height",     "ds-mobile-height-val",     "mobileHeight"],
        ["ds-mobile-maxwidth",   "ds-mobile-maxwidth-val",   "mobileMaxWidth"],
        ["ds-mobile-opacity",    "ds-mobile-opacity-val",    "mobileOpacity"],
        ["ds-mobile-zindex",     "ds-mobile-zindex-val",     "mobileZIndex"]
    ];
    for (const [id, lblId, path] of displaySliders) {
        bindSetting(id, path, { valueLabelId: lblId, onInput: applyDisplayStyles });
    }
    bindSetting("ds-desktop-position", "desktopPosition", { onInput: applyDisplayStyles });
    bindSetting("ds-mobile-position",  "mobilePosition",  { onInput: applyDisplayStyles });

    $("#ds-display-reset").on("click", function () {
        const displayKeys = [
            "desktopPosition", "desktopOffsetX", "desktopOffsetY", "desktopHeight",
            "desktopMaxWidth", "desktopOpacity", "desktopZIndex",
            "mobilePosition", "mobileOffsetX", "mobileOffsetY", "mobileHeight",
            "mobileMaxWidth", "mobileOpacity", "mobileZIndex", "mobileBreakpoint"
        ];
        displayKeys.forEach(k => settings[k] = defaultSettings[k]);
        applyDisplayStyles();
        saveSettingsDebounced();
        // UI 슬라이더/셀렉트 값 동기화
        document.getElementById("ds-desktop-position").value = settings.desktopPosition;
        document.getElementById("ds-mobile-position").value = settings.mobilePosition;
        displayKeys.forEach(k => {
            const map = {
                desktopOffsetX: ["ds-desktop-offset-x", "ds-desktop-offset-x-val"],
                desktopOffsetY: ["ds-desktop-offset-y", "ds-desktop-offset-y-val"],
                desktopHeight: ["ds-desktop-height", "ds-desktop-height-val"],
                desktopMaxWidth: ["ds-desktop-maxwidth", "ds-desktop-maxwidth-val"],
                desktopOpacity: ["ds-desktop-opacity", "ds-desktop-opacity-val"],
                desktopZIndex: ["ds-desktop-zindex", "ds-desktop-zindex-val"],
                mobileBreakpoint: ["ds-mobile-breakpoint", "ds-mobile-breakpoint-val"],
                mobileOffsetX: ["ds-mobile-offset-x", "ds-mobile-offset-x-val"],
                mobileOffsetY: ["ds-mobile-offset-y", "ds-mobile-offset-y-val"],
                mobileHeight: ["ds-mobile-height", "ds-mobile-height-val"],
                mobileMaxWidth: ["ds-mobile-maxwidth", "ds-mobile-maxwidth-val"],
                mobileOpacity: ["ds-mobile-opacity", "ds-mobile-opacity-val"],
                mobileZIndex: ["ds-mobile-zindex", "ds-mobile-zindex-val"]
            };
            if (map[k]) {
                const [sId, lId] = map[k];
                const s = document.getElementById(sId);
                const l = document.getElementById(lId);
                if (s) s.value = settings[k];
                if (l) l.textContent = settings[k];
            }
        });
        toastr.success("표시 설정을 기본값으로 되돌렸습니다");
    });

    // === 표시 설정 프리셋 ===
    const DISPLAY_KEYS = [
        "desktopPosition", "desktopOffsetX", "desktopOffsetY", "desktopHeight",
        "desktopMaxWidth", "desktopOpacity", "desktopZIndex",
        "mobilePosition", "mobileOffsetX", "mobileOffsetY", "mobileHeight",
        "mobileMaxWidth", "mobileOpacity", "mobileZIndex", "mobileBreakpoint"
    ];

    const DISPLAY_UI_MAP = {
        desktopOffsetX: ["ds-desktop-offset-x", "ds-desktop-offset-x-val"],
        desktopOffsetY: ["ds-desktop-offset-y", "ds-desktop-offset-y-val"],
        desktopHeight: ["ds-desktop-height", "ds-desktop-height-val"],
        desktopMaxWidth: ["ds-desktop-maxwidth", "ds-desktop-maxwidth-val"],
        desktopOpacity: ["ds-desktop-opacity", "ds-desktop-opacity-val"],
        desktopZIndex: ["ds-desktop-zindex", "ds-desktop-zindex-val"],
        mobileBreakpoint: ["ds-mobile-breakpoint", "ds-mobile-breakpoint-val"],
        mobileOffsetX: ["ds-mobile-offset-x", "ds-mobile-offset-x-val"],
        mobileOffsetY: ["ds-mobile-offset-y", "ds-mobile-offset-y-val"],
        mobileHeight: ["ds-mobile-height", "ds-mobile-height-val"],
        mobileMaxWidth: ["ds-mobile-maxwidth", "ds-mobile-maxwidth-val"],
        mobileOpacity: ["ds-mobile-opacity", "ds-mobile-opacity-val"],
        mobileZIndex: ["ds-mobile-zindex", "ds-mobile-zindex-val"]
    };

    function syncDisplayUI() {
        document.getElementById("ds-desktop-position").value = settings.desktopPosition;
        document.getElementById("ds-mobile-position").value = settings.mobilePosition;
        for (const k of DISPLAY_KEYS) {
            if (DISPLAY_UI_MAP[k]) {
                const [sId, lId] = DISPLAY_UI_MAP[k];
                const s = document.getElementById(sId);
                const l = document.getElementById(lId);
                if (s) s.value = settings[k];
                if (l) l.textContent = settings[k];
            }
        }
    }

    function renderPresetList() {
        const listEl = document.getElementById("ds-preset-list");
        if (!listEl) return;
        settings.displayPresets = settings.displayPresets || {};
        const names = Object.keys(settings.displayPresets);
        if (names.length === 0) {
            listEl.innerHTML = `<div class="ds-hint">저장된 프리셋 없음</div>`;
            return;
        }
        listEl.innerHTML = names.map(name => `
            <div style="display:flex; gap:4px; align-items:center;">
                <span style="flex:1; font-size:0.9em; padding:4px 8px; background:rgba(255,255,255,0.05); border-radius:4px;">${name}</span>
                <button class="menu_button ds-preset-load" data-name="${name}" style="padding:4px 8px;">불러오기</button>
                <button class="menu_button ds-preset-delete" data-name="${name}" style="padding:4px 8px;">삭제</button>
            </div>
        `).join("");

        listEl.querySelectorAll(".ds-preset-load").forEach(btn => {
            btn.addEventListener("click", e => {
                const name = e.currentTarget.dataset.name;
                const preset = settings.displayPresets[name];
                if (!preset) return;
                for (const k of DISPLAY_KEYS) {
                    if (preset[k] !== undefined) settings[k] = preset[k];
                }
                applyDisplayStyles();
                syncDisplayUI();
                saveSettingsDebounced();
                toastr.success(`"${name}" 프리셋 불러옴`);
            });
        });

        listEl.querySelectorAll(".ds-preset-delete").forEach(btn => {
            btn.addEventListener("click", e => {
                const name = e.currentTarget.dataset.name;
                if (!confirm(`"${name}" 프리셋을 삭제할까요?`)) return;
                delete settings.displayPresets[name];
                saveSettingsDebounced();
                renderPresetList();
            });
        });
    }

    $("#ds-preset-save").on("click", function () {
        const nameInput = document.getElementById("ds-preset-name");
        const name = nameInput.value.trim();
        if (!name) {
            toastr.warning("프리셋 이름을 입력하세요");
            return;
        }
        settings.displayPresets = settings.displayPresets || {};
        if (settings.displayPresets[name] && !confirm(`"${name}"이 이미 있어요. 덮어쓸까요?`)) return;
        const snapshot = {};
        for (const k of DISPLAY_KEYS) snapshot[k] = settings[k];
        settings.displayPresets[name] = snapshot;
        saveSettingsDebounced();
        nameInput.value = "";
        renderPresetList();
        toastr.success(`"${name}" 프리셋 저장됨`);
    });

    renderPresetList();

    // === 일괄 삭제 버튼 ===
    $("#ds-delete-current-char").on("click", async function () {
        const charName = getCurrentCharName();
        if (!charName) {
            toastr.warning("현재 캐릭터를 찾을 수 없습니다");
            return;
        }
        const charData = settings.characters[charName];
        const activePreset = getActivePreset(charName);
        if (!charData || activePreset.emotions.length === 0) {
            toastr.info(`"${charName}"에 등록된 감정이 없습니다`);
            return;
        }
        if (!confirm(`"${charName}"의 감정 ${activePreset.emotions.length}개를 모두 삭제할까요? (이미지 파일과 백업까지 삭제)`)) return;
        const count = await deleteAllEmotionsForChar(charName);
        renderEmotionList();
        toastr.success(`"${charName}"의 감정 ${count}개를 삭제했습니다`);
    });

    $("#ds-delete-all").on("click", async function () {
        const charCount = Object.keys(settings.characters).filter(n => {
            const cd = settings.characters[n];
            return cd.presets && Object.values(cd.presets).some(p => p.emotions.length > 0);
        }).length;
        if (charCount === 0) {
            toastr.info("삭제할 감정이 없습니다");
            return;
        }
        if (!confirm(`⚠️ 모든 캐릭터의 감정 데이터를 전부 삭제합니다.\n캐릭터 수: ${charCount}\n진짜로 삭제할까요? (되돌릴 수 없음)`)) return;
        if (!confirm("정말 확실해요? 마지막 확인입니다.")) return;
        const total = await deleteAllEmotionsEverywhere();
        renderEmotionList();
        toastr.success(`전체 ${total}개 감정을 삭제했습니다`);
    });

    // === 압축 / 백업 / 알림 ===
    bindSetting("ds-auto-compress", "autoCompress");
    bindSetting("ds-auto-backup",   "autoBackup");
    bindSetting("ds-compress-maxdim",  "compressMaxDim",  { valueLabelId: "ds-compress-maxdim-val" });
    bindSetting("ds-compress-quality", "compressQuality", { valueLabelId: "ds-compress-quality-val" });
    bindSetting("ds-notify-char-change", "notifyCharChange");

    // === 통계 / 그룹별 사용 ===
    function renderStats() {
        const contentEl = document.getElementById("ds-stats-content");
        if (!contentEl) return;
        const charName = getCurrentCharName();
        if (!charName) {
            contentEl.innerHTML = `<div class="ds-hint">캐릭터를 선택하세요</div>`;
            return;
        }
        const charData = settings.characters[charName];
        const statsPreset = getActivePreset(charName);
        if (!charData || statsPreset.emotions.length === 0) {
            contentEl.innerHTML = `<div class="ds-hint">"${charName}"에 등록된 감정 없음</div>`;
            return;
        }

        const totalUsage = statsPreset.emotions.reduce((sum, e) => sum + (e.usageCount || 0), 0);

        // 그룹별 통계
        const groupStats = {};
        const ungrouped = [];
        for (const emotion of statsPreset.emotions) {
            const usage = emotion.usageCount || 0;
            const groups = Array.isArray(emotion.groups) && emotion.groups.length > 0 ? emotion.groups : null;
            if (groups) {
                for (const g of groups) {
                    if (!groupStats[g]) groupStats[g] = { count: 0, emotions: [] };
                    groupStats[g].count += usage;
                    groupStats[g].emotions.push({ label: emotion.label, usage });
                }
            } else {
                ungrouped.push({ label: emotion.label, usage });
            }
        }

        // 라벨별 정렬
        const sortedEmotions = [...statsPreset.emotions].sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0));
        const top = sortedEmotions.slice(0, 5);
        const unused = statsPreset.emotions.filter(e => !e.usageCount).map(e => e.label);

        let html = `
            <div style="margin-bottom:8px; padding:8px; background:rgba(255,255,255,0.04); border-radius:6px;">
                <b>${charName}</b> · 총 분석 ${totalUsage}회 · 등록 감정 ${statsPreset.emotions.length}개
            </div>
        `;

        if (totalUsage > 0) {
            html += `<div style="margin-bottom:8px;"><b style="font-size:0.9em;">🔥 자주 쓰인 감정 (TOP 5)</b><br>`;
            html += top.filter(e => (e.usageCount || 0) > 0).map(e => {
                const pct = totalUsage > 0 ? Math.round((e.usageCount / totalUsage) * 100) : 0;
                return `<div style="display:flex; align-items:center; gap:6px; margin:3px 0;">
                    <span style="flex:1; font-size:0.88em;">${e.label}</span>
                    <span style="font-size:0.8em; opacity:0.7;">${e.usageCount}회 (${pct}%)</span>
                    <div style="width:60px; height:6px; background:rgba(255,255,255,0.08); border-radius:3px; overflow:hidden;">
                        <div style="height:100%; width:${pct}%; background:rgba(100,180,255,0.7);"></div>
                    </div>
                </div>`;
            }).join("");
            html += `</div>`;
        }

        if (Object.keys(groupStats).length > 0) {
            html += `<div style="margin-bottom:8px;"><b style="font-size:0.9em;">📂 그룹별 사용</b><br>`;
            const sortedGroups = Object.entries(groupStats).sort((a, b) => b[1].count - a[1].count);
            html += sortedGroups.map(([g, data]) => {
                const pct = totalUsage > 0 ? Math.round((data.count / totalUsage) * 100) : 0;
                return `<div style="display:flex; align-items:center; gap:6px; margin:3px 0;">
                    <span style="flex:1; font-size:0.88em;">${g} <span style="opacity:0.5; font-size:0.85em;">(${data.emotions.length}개)</span></span>
                    <span style="font-size:0.8em; opacity:0.7;">${data.count}회 (${pct}%)</span>
                    <div style="width:60px; height:6px; background:rgba(255,255,255,0.08); border-radius:3px; overflow:hidden;">
                        <div style="height:100%; width:${pct}%; background:rgba(180,140,255,0.7);"></div>
                    </div>
                </div>`;
            }).join("");
            html += `</div>`;
        }

        if (unused.length > 0) {
            html += `<div style="margin-bottom:8px;"><b style="font-size:0.9em; opacity:0.7;">💤 한 번도 안 쓰인 감정 (${unused.length}개)</b><br>
                <div style="font-size:0.82em; opacity:0.6; margin-top:3px;">${unused.join(", ")}</div>
            </div>`;
        }

        contentEl.innerHTML = html;
    }

    $("#ds-stats-refresh").on("click", renderStats);
    $("#ds-stats-reset").on("click", function () {
        if (!confirm("모든 캐릭터의 사용 횟수를 0으로 초기화할까요?")) return;
        for (const cn in settings.characters) {
            const cd = settings.characters[cn];
            for (const pName in cd.presets || {}) {
                for (const e of cd.presets[pName].emotions) {
                    e.usageCount = 0;
                }
            }
        }
        saveSettingsDebounced();
        renderStats();
        renderEmotionList();
        toastr.success("사용 횟수 초기화됨");
    });

    renderStats();

    // === 분석 프롬프트 / API 모드 ===
    bindSetting("ds-custom-prompt",    "customPrompt",    { parser: (v) => v });
    bindSetting("ds-relation-context", "relationContext", { parser: (v) => v });
    bindSetting("ds-api-mode",         "apiMode",         { onInput: updateApiFieldsVisibility });
    bindSetting("ds-api-profile",      "apiProfile");
    bindSetting("ds-api-key",          "apiKey",          { parser: (v) => v });
    bindSetting("ds-api-endpoint",     "apiEndpoint");
    bindSetting("ds-api-model",        "apiModel");

    $("#ds-refresh-profiles").on("click", () => {
        renderProfileDropdown();
        toastr.info("프로필 목록 갱신됨");
    });

    $("#ds-key-toggle").on("click", function () {
        const input = document.getElementById("ds-api-key");
        if (input.type === "password") {
            input.type = "text";
            this.textContent = "숨기기";
        } else {
            input.type = "password";
            this.textContent = "보기";
        }
    });

    $("#ds-api-test").on("click", async function () {
        const resultEl = $("#ds-api-test-result");
        resultEl.html("🔄 테스트 중...");
        try {
            const testPrompt = `Reply with exactly the word: ok`;
            const startTime = performance.now();
            const result = await callAnalysisProvider(testPrompt);
            const elapsed = Math.round(performance.now() - startTime);
            resultEl.html(`✅ 연결 성공 (${elapsed}ms) - 응답: <code>${result.trim().slice(0, 50)}</code>`);
        } catch (err) {
            resultEl.html(`❌ 실패: ${err.message}`);
        }
    });

    // 파일들 업로드
    $("#ds-upload-files-btn").on("click", () => $("#ds-file-input").trigger("click"));

    $("#ds-file-input").on("change", async function () {
        const files = Array.from(this.files);
        if (files.length === 0) return;
        const status = $("#ds-upload-status");
        const results = [];
        let i = 0;
        for (const file of files) {
            i++;
            status.html(`처리 중... (${i}/${files.length}) - ${file.name}`);
            try {
                const label = await addEmotion(file);
                if (label) results.push(`✅ <b>${label}</b>`);
            } catch (err) {
                results.push(`❌ ${file.name}`);
            }
        }
        status.html(results.join(" "));
        renderEmotionList();
        this.value = "";
    });

    // 폴더 통째 업로드
    $("#ds-upload-folder-btn").on("click", () => $("#ds-folder-input").trigger("click"));

    $("#ds-folder-input").on("change", async function () {
        const files = Array.from(this.files);
        if (files.length === 0) return;
        await handleFolderUpload(files);
        this.value = "";
    });

    $("#ds-refresh").on("click", renderEmotionList);


    $("#ds-test-btn").on("click", async function () {
        const text = $("#ds-test-input").val();
        if (!text.trim()) return;
        $("#ds-test-result").text("분석 중...");
        const emotion = await analyzeEmotion(text);
        if (emotion) {
            $("#ds-test-result").html(`→ <b>${emotion}</b>`);
            updateSprite(emotion);
        } else {
            $("#ds-test-result").text("⚠️ 등록된 감정이 없거나 분석 실패");
        }
    });

    $("#ds-export").on("click", async () => {
        const exportData = {
            version: 4,
            settings: { ...extension_settings[extensionName] },
            images: {}
        };
        delete exportData.settings.apiKey;

        for (const charName in extension_settings[extensionName].characters) {
            const cd = extension_settings[extensionName].characters[charName];
            for (const pName in cd.presets || {}) {
                for (const emotion of cd.presets[pName].emotions) {
                    const blob = await loadImage(emotion.imageKey);
                    if (blob) exportData.images[emotion.imageKey] = await blobToBase64(blob);
                }
            }
        }

        const json = JSON.stringify(exportData);
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `dynamic-sprites-backup-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        toastr.success("백업 다운로드 완료 (API 키 제외)");
    });

    $("#ds-import-btn").on("click", () => $("#ds-import-input").trigger("click"));

    $("#ds-import-input").on("change", async function () {
        const file = this.files[0];
        if (!file) return;
        if (!confirm("기존 설정과 병합됩니다. 진행할까요?")) return;
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            const stg = extension_settings[extensionName];
            stg.imageBackup = stg.imageBackup || {};
            for (const key in data.images) {
                const base64 = data.images[key];
                const blob = await base64ToBlob(base64);
                await saveImage(key, blob);
                // 백업에도 저장해서 다음 origin 변경 시에도 안전
                stg.imageBackup[key] = base64;
            }
            Object.assign(stg.characters, data.settings.characters);
            // 프리셋도 있으면 병합
            if (data.settings.displayPresets) {
                stg.displayPresets = stg.displayPresets || {};
                Object.assign(stg.displayPresets, data.settings.displayPresets);
            }
            saveSettingsDebounced();
            renderEmotionList();
            renderPresetList();
            toastr.success("가져오기 완료");
        } catch (err) {
            toastr.error("가져오기 실패: " + err.message);
        }
        this.value = "";
    });

    let lastNotifiedChar = null;
    eventSource.on(event_types.CHAT_CHANGED, async () => {
        setTimeout(async () => {
            renderEmotionList();

            const charName = getCurrentCharName();
            if (!charName) return;

            const charData = settings.characters[charName];
            const img = document.getElementById("dynamic-sprite-img");
            const switchPreset = charData ? getActivePreset(charName) : null;

            if (switchPreset && switchPreset.emotions.length > 0) {
                const targetLabel = switchPreset.current
                    || switchPreset.emotions.find(e => e.label.toLowerCase() === "neutral")?.label
                    || switchPreset.emotions[0].label;
                await updateSprite(targetLabel);
            } else {
                if (img) {
                    img.style.opacity = "0";
                    setTimeout(() => { img.style.display = "none"; }, settings.transitionDuration || 300);
                }
            }

            if (charName !== lastNotifiedChar) {
                if (settings.notifyCharChange && lastNotifiedChar !== null) {
                    toastr.info(`캐릭터 변경: ${charName}`, "", { timeOut: 1500 });
                }
                lastNotifiedChar = charName;
                syncNaiCharUI?.();
            }
        }, 300);
    });

    // === NAI 설정 ===
    bindSetting("ds-nai-provider", "naiConfig.provider");
    bindSetting("ds-nai-key",          "naiConfig.apiKey",         { parser: (v) => v });
    const modelSelect = document.getElementById("ds-nai-model");
    const customModelInput = document.getElementById("ds-nai-custom-model");
    const customModelField = document.getElementById("ds-nai-custom-model-field");
    const savedModel = settings.naiConfig.model ?? "nai-diffusion-4-5-full";
    const isPresetModel = [...modelSelect.options].some(option => option.value !== "custom" && option.value === savedModel);
    modelSelect.value = settings.naiConfig.modelMode === "custom" || !isPresetModel ? "custom" : savedModel;
    customModelInput.value = modelSelect.value === "custom" ? savedModel : (settings.naiConfig.customModel || "");
    customModelField.hidden = modelSelect.value !== "custom";
    modelSelect.addEventListener("change", () => {
        const custom = modelSelect.value === "custom";
        customModelField.hidden = !custom;
        settings.naiConfig.modelMode = custom ? "custom" : "preset";
        settings.naiConfig.model = custom ? customModelInput.value.trim() : modelSelect.value;
        saveSettingsDebounced();
    });
    customModelInput.addEventListener("input", () => {
        settings.naiConfig.customModel = customModelInput.value.trim();
        if (modelSelect.value === "custom") settings.naiConfig.model = settings.naiConfig.customModel;
        saveSettingsDebounced();
    });
    bindSetting("ds-nai-steps",        "naiConfig.steps",          { valueLabelId: "ds-nai-steps-val" });
    bindSetting("ds-nai-scale",        "naiConfig.scale",          { valueLabelId: "ds-nai-scale-val" });
    bindSetting("ds-nai-rescale",      "naiConfig.cfgRescale",     { valueLabelId: "ds-nai-rescale-val" });
    bindSetting("ds-nai-style-prompt", "naiConfig.stylePrompt");
    bindSetting("ds-nai-style-neg",    "naiConfig.styleNegPrompt");
    bindSetting("ds-nai-locked-seed",  "naiConfig.lockedSeed",     { parser: (v) => parseInt(v) || -1 });
    bindSetting("ds-nai-bg-thresh",    "naiConfig.removeBgThreshold", { valueLabelId: "ds-nai-bg-thresh-val" });
    bindSetting("ds-nai-label-intensity", "naiConfig.labelIntensity",  { parser: (v) => parseFloat(v) || 2 });

    bindSetting("ds-nai-seed-lock", "naiConfig.seedLocked", {
        onInput: (checked) => {
            const row = document.getElementById("ds-nai-seed-row");
            if (row) row.style.display = checked ? "flex" : "none";
        }
    });
    bindSetting("ds-nai-auto-bg", "naiConfig.autoRemoveBg", {
        onInput: (checked) => {
            const row = document.getElementById("ds-nai-bg-row");
            if (row) row.style.display = checked ? "block" : "none";
        }
    });

    // 키 표시 토글 (DOM 전용 — 설정값 없음)
    $("#ds-nai-key-toggle").on("click", function () {
        const input = document.getElementById("ds-nai-key");
        if (input.type === "password") { input.type = "text"; this.textContent = "숨기기"; }
        else { input.type = "password"; this.textContent = "보기"; }
    });

    // 해상도: "WxH" 형식을 width/height 두 필드로 분리해 저장 (특수 케이스)
    $("#ds-nai-size").on("change", function () {
        const [w, h] = this.value.split("x").map(Number);
        settings.naiConfig = settings.naiConfig || {};
        settings.naiConfig.width = w;
        settings.naiConfig.height = h;
        saveSettingsDebounced();
    });
    if (settings.naiConfig?.width && settings.naiConfig?.height) {
        const sizeSelect = document.getElementById("ds-nai-size");
        if (sizeSelect) sizeSelect.value = `${settings.naiConfig.width}x${settings.naiConfig.height}`;
    }

    // 랜덤 시드 버튼
    document.getElementById("ds-nai-seed-random")?.addEventListener("click", () => {
        const newSeed = Math.floor(Math.random() * 4294967295);
        settings.naiConfig = settings.naiConfig || {};
        settings.naiConfig.lockedSeed = newSeed;
        const input = document.getElementById("ds-nai-locked-seed");
        if (input) input.value = newSeed;
        saveSettingsDebounced();
    });

    // 단일 빠른 생성
    $("#ds-nai-quick-gen").on("click", async function () {
        const label = document.getElementById("ds-nai-quick-label")?.value.trim();
        const resultEl = document.getElementById("ds-nai-quick-result");
        if (!label) { toastr.warning("라벨명을 입력하세요."); return; }
        if (!hasImageConnection(settings.naiConfig, extension_settings.sharednai_bridge)) { toastr.warning("NAI API 키를 입력하거나 SharedNAI 연결을 활성화하세요."); return; }
        const charName = getCurrentCharName();
        if (!charName) { toastr.warning("캐릭터를 선택하세요."); return; }
        this.disabled = true;
        if (resultEl) resultEl.textContent = "⏳ 생성 중...";
        try {
            const usedSeed = await generateSpriteForLabel(charName, label);
            renderEmotionList();
            if (resultEl) resultEl.textContent = `✅ "${label}" 생성 완료  |  seed: ${usedSeed}`;
            toastr.success(`seed: ${usedSeed}`, `"${label}" 생성 완료`, { timeOut: 8000 });
        } catch (err) {
            if (resultEl) resultEl.textContent = `❌ ${err.message}`;
            toastr.error(`생성 실패: ${err.message}`);
        } finally {
            this.disabled = false;
        }
    });

    $("#ds-nai-test").on("click", async function () {
        const resultEl = $("#ds-nai-test-result");
        const btn = $(this);
        btn.prop("disabled", true);
        resultEl.html("🔄 생성 중... (10~30초 소요)");

        try {
            const testPrompt = "1girl, smile, simple background, masterpiece, best quality";
            const negPrompt = "worst quality, bad anatomy, lowres";
            const startTime = performance.now();

            const { blob: imageBlob, seed: usedSeed } = await callNovelAI(testPrompt, negPrompt, settings.naiConfig);
            const elapsed = Math.round((performance.now() - startTime) / 1000);

            const url = URL.createObjectURL(imageBlob);
            toastr.success(`seed: ${usedSeed}`, "NAI 생성 성공", { timeOut: 8000 });
            resultEl.html(`
                ✅ 생성 성공 (${elapsed}초, ${Math.round(imageBlob.size / 1024)}KB)<br>
                <span style="font-size:0.9em; display:block; margin:4px 0;">seed: <b style="user-select:all;">${usedSeed}</b>
                &nbsp;<button class="menu_button ds-pin-seed" data-seed="${usedSeed}" style="padding:1px 8px; font-size:0.82em; height:auto;">이 시드 고정</button></span>
                <img src="${url}" style="max-width:200px; border-radius:6px; margin-top:8px; display:block;">
            `);
            resultEl.find(".ds-pin-seed").on("click", function () {
                const s = parseInt(this.dataset.seed);
                settings.naiConfig.seedLocked = true;
                settings.naiConfig.lockedSeed = s;
                saveSettingsDebounced();
                const cb = document.getElementById("ds-nai-seed-lock");
                const row = document.getElementById("ds-nai-seed-row");
                const inp = document.getElementById("ds-nai-locked-seed");
                if (cb) cb.checked = true;
                if (row) row.style.display = "flex";
                if (inp) inp.value = s;
                toastr.success(`시드 ${s} 고정됨`);
            });
        } catch (err) {
            resultEl.html(`❌ 실패: ${err.message}`);
        } finally {
            btn.prop("disabled", false);
        }
    });

    // === NAI 캐릭터 프롬프트 핸들러 ===
    function syncNaiCharUI() {
        const charName = getCurrentCharName();
        if (!charName) return;
        const charData = getCharData(charName);
        const naiGen = charData.naiGen || {};
        const baseEl = document.getElementById("ds-nai-base-prompt");
        const negEl = document.getElementById("ds-nai-neg-prompt");
        if (baseEl) baseEl.value = naiGen.basePrompt || "";
        if (negEl) negEl.value = naiGen.negativePrompt || "";
    }

    $("#ds-nai-base-prompt").on("change", function () {
        const charName = getCurrentCharName();
        if (!charName) return;
        const cd = getCharData(charName);
        if (!cd.naiGen) cd.naiGen = { basePrompt: "", negativePrompt: "", labelPrompts: {} };
        cd.naiGen.basePrompt = this.value.trim();
        saveSettingsDebounced();
    });

    $("#ds-nai-neg-prompt").on("change", function () {
        const charName = getCurrentCharName();
        if (!charName) return;
        const cd = getCharData(charName);
        if (!cd.naiGen) cd.naiGen = { basePrompt: "", negativePrompt: "", labelPrompts: {} };
        cd.naiGen.negativePrompt = this.value.trim();
        saveSettingsDebounced();
    });

    syncNaiCharUI();
    updateApiFieldsVisibility();

    // === 탭 전환 ===
    const setActiveTab = (tab) => {
        document.querySelectorAll("#dynamic-sprites-settings .ds-tab-btn").forEach(btn => {
            btn.classList.toggle("ds-tab-active", btn.dataset.tab === tab);
        });
        document.querySelectorAll("#dynamic-sprites-settings .ds-tab-panel").forEach(panel => {
            panel.hidden = panel.dataset.tab !== tab;
        });
        // NAI 탭 열리면 캐릭터 프롬프트 동기화
        if (tab === "nai") setTimeout(syncNaiCharUI, 50);
        // 마지막 탭 기억
        settings.activeTab = tab;
        saveSettingsDebounced();
    };

    document.querySelectorAll("#dynamic-sprites-settings .ds-tab-btn").forEach(btn => {
        btn.addEventListener("click", () => setActiveTab(btn.dataset.tab));
    });

    // 초기 탭: 저장된 값이 있으면 사용, 없으면 '이미지'
    const validTabs = ["image", "display", "nai", "analyze", "settings"];
    const initialTab = validTabs.includes(settings.activeTab) ? settings.activeTab : "image";
    setActiveTab(initialTab);
}

// ====================================================================
// 초기화
// ====================================================================
jQuery(async () => {
    try {
        loadSettings();
        await openDB();
        createSpriteContainer();
        applyDisplayStyles();
        createSettingsPanel();
        applyTheme();

        // 모바일 감정 리스트 독립 스크롤 (scrollTop 직접 제어)
        addWandMenuItems();

        // origin이 바뀌어서 IndexedDB가 비어있는데 백업은 있는 경우 자동 복원
        try {
            const restored = await autoRestoreFromBackup();
            if (restored > 0) {
                console.log(`[DynamicSprite] 백업에서 ${restored}개 이미지 자동 복원됨`);
                toastr.success(`이미지 ${restored}개를 백업에서 자동 복원했습니다`, "Dynamic Sprite", { timeOut: 4000 });
            }
        } catch (err) {
            console.warn("[DynamicSprite] 자동 복원 실패:", err);
        }

        eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
        eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, onMessageReceived);

        setTimeout(renderEmotionList, 500);
        console.log("[DynamicSprite] v5 로드 완료");
    } catch (err) {
        console.error("[DynamicSprite] 초기화 실패:", err);
    }
});

// ====================================================================
// 마술봉(Wand) 메뉴 - 빠른 토글 버튼들
// ====================================================================
function addWandMenuItems() {
    const settings = extension_settings[extensionName];
    const menuId = "extensionsMenu";
    const menu = document.getElementById(menuId);
    if (!menu) {
        // ST가 아직 메뉴 안 만들었을 수 있음 - 재시도
        setTimeout(addWandMenuItems, 500);
        return;
    }
    // 이미 추가됐으면 패스
    if (document.getElementById("ds-wand-toggle")) return;

    // 1) 스프라이트 표시 ON/OFF 토글
    const toggleItem = document.createElement("div");
    toggleItem.id = "ds-wand-toggle";
    toggleItem.className = "list-group-item flex-container flexGap5 interactable";
    toggleItem.tabIndex = 0;
    toggleItem.innerHTML = `
        <div class="fa-solid fa-masks-theater extensionsMenuExtensionButton"></div>
        <span id="ds-wand-toggle-label">${settings.showSprite ? "스프라이트 숨기기" : "스프라이트 표시"}</span>
    `;
    toggleItem.addEventListener("click", () => {
        settings.showSprite = !settings.showSprite;
        const img = document.getElementById("dynamic-sprite-img");
        if (img) {
            if (settings.showSprite) {
                if (img.src) {
                    img.style.display = "block";
                    requestAnimationFrame(() => { img.style.opacity = "1"; });
                }
            } else {
                img.style.opacity = "0";
                setTimeout(() => { img.style.display = "none"; }, settings.transitionDuration || 300);
            }
        }
        document.getElementById("ds-wand-toggle-label").textContent =
            settings.showSprite ? "스프라이트 숨기기" : "스프라이트 표시";
        // 설정 패널의 체크박스도 동기화
        const cb = document.getElementById("ds-show-sprite");
        if (cb) cb.checked = settings.showSprite;
        saveSettingsDebounced();
        toastr.info(settings.showSprite ? "스프라이트 표시" : "스프라이트 숨김", "", { timeOut: 1500 });
    });
    menu.appendChild(toggleItem);

    // 2) 수동 감정 변경 (라벨 목록에서 선택)
    const pickerItem = document.createElement("div");
    pickerItem.id = "ds-wand-picker";
    pickerItem.className = "list-group-item flex-container flexGap5 interactable";
    pickerItem.tabIndex = 0;
    pickerItem.innerHTML = `
        <div class="fa-solid fa-face-smile extensionsMenuExtensionButton"></div>
        <span>감정 수동 선택</span>
    `;
    pickerItem.addEventListener("click", () => {
        showEmotionPickerPopup();
    });
    menu.appendChild(pickerItem);

    // 3) 분석 일시 정지 토글
    const pauseItem = document.createElement("div");
    pauseItem.id = "ds-wand-pause";
    pauseItem.className = "list-group-item flex-container flexGap5 interactable";
    pauseItem.tabIndex = 0;
    pauseItem.innerHTML = `
        <div class="fa-solid fa-pause extensionsMenuExtensionButton"></div>
        <span id="ds-wand-pause-label">${settings.enabled ? "감정 분석 정지" : "감정 분석 재개"}</span>
    `;
    pauseItem.addEventListener("click", () => {
        settings.enabled = !settings.enabled;
        document.getElementById("ds-wand-pause-label").textContent =
            settings.enabled ? "감정 분석 정지" : "감정 분석 재개";
        const cb = document.getElementById("ds-enabled");
        if (cb) cb.checked = settings.enabled;
        saveSettingsDebounced();
        toastr.info(settings.enabled ? "감정 분석 켜짐" : "감정 분석 꺼짐", "", { timeOut: 1500 });
    });
    menu.appendChild(pauseItem);
}

// ====================================================================
// 감정 수동 선택 팝업 (마술봉 메뉴에서 호출)
// ====================================================================
function showEmotionPickerPopup() {
    const charName = getCurrentCharName();
    if (!charName) {
        toastr.warning("캐릭터를 선택하세요");
        return;
    }
    const charData = getCharData(charName);
    const pickerPreset = getActivePreset(charName);
    if (!pickerPreset || pickerPreset.emotions.length === 0) {
        toastr.warning(`"${charName}"에 등록된 감정이 없습니다`);
        return;
    }

    // 이미 떠있으면 제거
    const existing = document.getElementById("ds-emotion-picker-popup");
    if (existing) {
        existing.remove();
        return;
    }

    const popup = document.createElement("div");
    popup.id = "ds-emotion-picker-popup";
    popup.innerHTML = `
        <div class="ds-picker-popup-header">
            <span>감정 선택 — ${charName}</span>
            <button class="ds-picker-popup-close" title="닫기">✕</button>
        </div>
        <div class="ds-picker-popup-grid">
            ${pickerPreset.emotions.map(e => `
                <button class="ds-picker-popup-item ${e.label === pickerPreset.current ? "ds-picker-popup-current" : ""}" data-label="${e.label}">
                    ${e.label}
                </button>
            `).join("")}
        </div>
    `;
    document.body.appendChild(popup);

    popup.querySelectorAll(".ds-picker-popup-item").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const label = e.currentTarget.dataset.label;
            updateSprite(label);
            popup.remove();
        });
    });
    popup.querySelector(".ds-picker-popup-close").addEventListener("click", () => {
        popup.remove();
    });

    // 바깥 클릭 닫기
    setTimeout(() => {
        const closeOnOutside = (ev) => {
            if (!popup.contains(ev.target)) {
                popup.remove();
                document.removeEventListener("click", closeOnOutside);
            }
        };
        document.addEventListener("click", closeOnOutside);
    }, 100);
}
