// ====================================================================
// 설정 패널 HTML 템플릿
// buildPanelHtml(settings) → 인라인 드로어 + 마스터 토글 + 5개 탭
// 이벤트 바인딩은 index.js의 createSettingsPanel()이 담당
// ====================================================================
export function buildPanelHtml(settings) {
    return `
    <div id="dynamic-sprites-settings" class="dynamic-sprites-settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Dynamic Sprite</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">

                <!-- 마스터 토글 (탭 위 항상 노출) -->
                <div class="ds-master">
                    <label class="checkbox_label">
                        <input id="ds-enabled" type="checkbox" ${settings.enabled ? "checked" : ""}>
                        <span>확장 활성화</span>
                    </label>
                    <label class="checkbox_label">
                        <input id="ds-show-sprite" type="checkbox" ${settings.showSprite ? "checked" : ""}>
                        <span>스프라이트 표시</span>
                    </label>
                </div>

                <!-- 탭 -->
                <div class="ds-tabs">
                    <button class="ds-tab-btn" data-tab="image">이미지</button>
                    <button class="ds-tab-btn" data-tab="display">표시</button>
                    <button class="ds-tab-btn" data-tab="nai">AI 생성</button>
                    <button class="ds-tab-btn" data-tab="analyze">분석</button>
                    <button class="ds-tab-btn" data-tab="settings">설정</button>
                </div>

                <!-- ============================================================
                     Tab: 이미지 (현재 캐릭터 감정 리스트 / 추가 / 압축 / 통계)
                ============================================================ -->
                <div class="ds-tab-panel" data-tab="image">
                    <h4><i class="fa-solid fa-user ds-h4-icon"></i>현재 캐릭터: <span id="ds-current-char" style="color:var(--SmartThemeQuoteColor);"></span></h4>
                    <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:8px;">
                        <button id="ds-delete-current-char" class="menu_button" style="flex:1; min-width:120px;">현재 캐릭터 감정 전체 삭제</button>
                        <button id="ds-delete-all" class="menu_button" style="flex:1; min-width:120px; color:#ff8080;">모든 캐릭터 전체 삭제</button>
                    </div>
                    <div id="ds-emotion-list" class="ds-emotion-list"></div>
                    <div class="ds-list-nav">
                        <button class="menu_button ds-list-nav-btn" id="ds-list-up" title="위로">↑</button>
                        <button class="menu_button ds-list-nav-btn" id="ds-list-down" title="아래로">↓</button>
                    </div>

                    <hr>
                    <h4><i class="fa-solid fa-upload ds-h4-icon"></i>감정 이미지 추가</h4>
                    <p class="ds-hint">파일명에서 라벨 자동 추출 (예: <code>SPR_Damian_aloof.png</code> → <code>aloof</code>).</p>
                    <input type="file" id="ds-file-input" accept="image/*" multiple style="display:none;">
                    <input type="file" id="ds-folder-input" webkitdirectory directory multiple style="display:none;">
                    <div class="ds-upload-buttons">
                        <button id="ds-upload-files-btn" class="menu_button">파일들 선택</button>
                        <button id="ds-upload-folder-btn" class="menu_button">폴더 통째로</button>
                    </div>
                    <div id="ds-upload-status"></div>

                    <hr>
                    <h4><i class="fa-solid fa-file-zipper ds-h4-icon"></i>이미지 압축 / 백업</h4>
                    <p class="ds-hint">압축 켜면 업로드 시 자동으로 리사이즈/WebP 변환. 백업은 ST 설정에 base64로 저장해서 origin이 바뀌어도 자동 복원됨.</p>
                    <label class="checkbox_label">
                        <input id="ds-auto-compress" type="checkbox" ${settings.autoCompress !== false ? "checked" : ""}>
                        <span>자동 압축 사용</span>
                    </label>
                    <label class="checkbox_label">
                        <input id="ds-auto-backup" type="checkbox" ${settings.autoBackup !== false ? "checked" : ""}>
                        <span>자동 백업 사용 (origin 변경 대비)</span>
                    </label>
                    <label>최대 크기 (가장 긴 변, px) — <span id="ds-compress-maxdim-val">${settings.compressMaxDim || 800}</span></label>
                    <input id="ds-compress-maxdim" type="range" min="200" max="2000" step="50" value="${settings.compressMaxDim || 800}" class="ds-slider">
                    <label>품질 (%) — <span id="ds-compress-quality-val">${settings.compressQuality || 85}</span></label>
                    <input id="ds-compress-quality" type="range" min="30" max="100" step="5" value="${settings.compressQuality || 85}" class="ds-slider">

                    <hr>
                    <h4><i class="fa-solid fa-chart-simple ds-h4-icon"></i>통계 / 그룹별 사용</h4>
                    <p class="ds-hint">현재 캐릭터의 감정 사용 통계. 그룹은 감정 카드의 "그룹/태그" 입력으로 지정.</p>
                    <div style="display:flex; gap:6px; margin-bottom:8px;">
                        <button id="ds-stats-refresh" class="menu_button" style="flex:1;">통계 새로고침</button>
                        <button id="ds-stats-reset" class="menu_button" style="flex:1;">카운트 초기화</button>
                    </div>
                    <div id="ds-stats-content"></div>
                </div>

                <!-- ============================================================
                     Tab: 표시 (데스크탑 / 모바일 / 표시 프리셋)
                ============================================================ -->
                <div class="ds-tab-panel" data-tab="display" hidden>
                    <h4><i class="fa-solid fa-display ds-h4-icon"></i>데스크탑 표시 설정</h4>
                    <label>위치</label>
                    <select id="ds-desktop-position" class="text_pole">
                        <option value="bottom-left" ${settings.desktopPosition === "bottom-left" ? "selected" : ""}>왼쪽 아래</option>
                        <option value="bottom-center" ${settings.desktopPosition === "bottom-center" ? "selected" : ""}>중앙 아래</option>
                        <option value="bottom-right" ${settings.desktopPosition === "bottom-right" ? "selected" : ""}>오른쪽 아래</option>
                    </select>

                    <label>가장자리 여백 X (px) — <span id="ds-desktop-offset-x-val">${settings.desktopOffsetX}</span></label>
                    <input id="ds-desktop-offset-x" type="range" min="0" max="500" value="${settings.desktopOffsetX}" class="ds-slider">

                    <label>바닥 여백 Y (px) — <span id="ds-desktop-offset-y-val">${settings.desktopOffsetY}</span></label>
                    <input id="ds-desktop-offset-y" type="range" min="0" max="500" value="${settings.desktopOffsetY}" class="ds-slider">

                    <label>높이 (화면 대비 %) — <span id="ds-desktop-height-val">${settings.desktopHeight}</span></label>
                    <input id="ds-desktop-height" type="range" min="10" max="100" value="${settings.desktopHeight}" class="ds-slider">

                    <label>최대 너비 (px) — <span id="ds-desktop-maxwidth-val">${settings.desktopMaxWidth}</span></label>
                    <input id="ds-desktop-maxwidth" type="range" min="50" max="1000" step="10" value="${settings.desktopMaxWidth}" class="ds-slider">

                    <label>투명도 (%) — <span id="ds-desktop-opacity-val">${settings.desktopOpacity}</span></label>
                    <input id="ds-desktop-opacity" type="range" min="10" max="100" value="${settings.desktopOpacity}" class="ds-slider">

                    <label>z-index (다른 UI보다 위로 띄우려면 높임) — <span id="ds-desktop-zindex-val">${settings.desktopZIndex}</span></label>
                    <input id="ds-desktop-zindex" type="range" min="0" max="9999" step="10" value="${settings.desktopZIndex}" class="ds-slider">

                    <hr>
                    <h4><i class="fa-solid fa-mobile-screen ds-h4-icon"></i>모바일 표시 설정</h4>
                    <p class="ds-hint">화면 너비가 아래 기준 이하일 때 적용됨.</p>

                    <label>모바일 기준 너비 (px) — <span id="ds-mobile-breakpoint-val">${settings.mobileBreakpoint}</span></label>
                    <input id="ds-mobile-breakpoint" type="range" min="320" max="1200" step="10" value="${settings.mobileBreakpoint}" class="ds-slider">

                    <label>위치</label>
                    <select id="ds-mobile-position" class="text_pole">
                        <option value="bottom-left" ${settings.mobilePosition === "bottom-left" ? "selected" : ""}>왼쪽 아래</option>
                        <option value="bottom-center" ${settings.mobilePosition === "bottom-center" ? "selected" : ""}>중앙 아래</option>
                        <option value="bottom-right" ${settings.mobilePosition === "bottom-right" ? "selected" : ""}>오른쪽 아래</option>
                    </select>

                    <label>가장자리 여백 X (px) — <span id="ds-mobile-offset-x-val">${settings.mobileOffsetX}</span></label>
                    <input id="ds-mobile-offset-x" type="range" min="0" max="300" value="${settings.mobileOffsetX}" class="ds-slider">

                    <label>바닥 여백 Y (px) — <span id="ds-mobile-offset-y-val">${settings.mobileOffsetY}</span></label>
                    <input id="ds-mobile-offset-y" type="range" min="0" max="500" value="${settings.mobileOffsetY}" class="ds-slider">

                    <label>높이 (화면 대비 %) — <span id="ds-mobile-height-val">${settings.mobileHeight}</span></label>
                    <input id="ds-mobile-height" type="range" min="10" max="100" value="${settings.mobileHeight}" class="ds-slider">

                    <label>최대 너비 (px) — <span id="ds-mobile-maxwidth-val">${settings.mobileMaxWidth}</span></label>
                    <input id="ds-mobile-maxwidth" type="range" min="50" max="800" step="10" value="${settings.mobileMaxWidth}" class="ds-slider">

                    <label>투명도 (%) — <span id="ds-mobile-opacity-val">${settings.mobileOpacity}</span></label>
                    <input id="ds-mobile-opacity" type="range" min="10" max="100" value="${settings.mobileOpacity}" class="ds-slider">

                    <label>z-index (모바일 채팅창에 가려지면 높임) — <span id="ds-mobile-zindex-val">${settings.mobileZIndex}</span></label>
                    <input id="ds-mobile-zindex" type="range" min="0" max="9999" step="10" value="${settings.mobileZIndex}" class="ds-slider">

                    <button id="ds-display-reset" class="menu_button" style="margin-top:10px;">표시 설정 기본값으로</button>

                    <hr>
                    <h4><i class="fa-solid fa-bookmark ds-h4-icon"></i>표시 설정 프리셋</h4>
                    <p class="ds-hint">현재 표시 설정(데스크탑+모바일)을 이름 붙여 저장. 캐릭터별로 다른 위치 쓸 때 편함.</p>
                    <div style="display:flex; gap:6px; flex-wrap:wrap;">
                        <input type="text" id="ds-preset-name" class="text_pole" placeholder="프리셋 이름" style="flex:1; min-width:140px;">
                        <button id="ds-preset-save" class="menu_button">저장</button>
                    </div>
                    <div id="ds-preset-list" style="margin-top:8px; display:flex; flex-direction:column; gap:4px;"></div>

                    <hr>
                    <h4><i class="fa-solid fa-wand-magic-sparkles ds-h4-icon"></i>기타</h4>
                    <label>전환 효과 시간 (ms)</label>
                    <input id="ds-transition" type="number" class="text_pole"
                        value="${settings.transitionDuration}" min="0" max="2000">
                </div>

                <!-- ============================================================
                     Tab: AI 생성 (NovelAI)
                ============================================================ -->
                <div class="ds-tab-panel" data-tab="nai" hidden>
                    <h4><i class="fa-solid fa-wand-magic-sparkles ds-h4-icon"></i>AI 표정 생성 (NovelAI)</h4>
                    <p class="ds-hint">자동 모드에서는 SharedNAI 연결 확장이 활성화되면 기존 로그인을 사용합니다. SharedNAI 사용 시 아래 API 키는 필요 없습니다. 연결 오류 시 공식 API로 전환하지 않습니다.</p>

                    <label>이미지 생성 연결</label>
                    <select id="ds-nai-provider" class="text_pole">
                        <option value="auto" ${(!settings.naiConfig?.provider || settings.naiConfig.provider === "auto") ? "selected" : ""}>자동 (SharedNAI 활성화 시 우선 사용)</option>
                        <option value="sharednai" ${settings.naiConfig?.provider === "sharednai" ? "selected" : ""}>SharedNAI 기존 로그인 사용</option>
                        <option value="novelai" ${settings.naiConfig?.provider === "novelai" ? "selected" : ""}>NovelAI 공식 API</option>
                    </select>
                    <p class="ds-hint">SharedNAI 계정 연결은 확장 설정의 ‘SharedNAI 연결’에서 진행하세요. 이미지 모델·해상도·시드는 여기서 설정합니다.</p>
                    <label>NovelAI API 키 (공식 API 사용 시)</label>
                    <div class="ds-key-input-wrap">
                        <input type="password" id="ds-nai-key" class="text_pole"
                            value="${settings.naiConfig?.apiKey || ""}" autocomplete="off"
                            placeholder="pst-...">
                        <button type="button" id="ds-nai-key-toggle" class="menu_button" title="키 표시/숨김">보기</button>
                    </div>

                    <label>모델</label>
                    <select id="ds-nai-model" class="text_pole">
                        <option value="nai-diffusion-4-5-full" ${settings.naiConfig?.model === "nai-diffusion-4-5-full" ? "selected" : ""}>NAI Diffusion V4.5 Full (최신)</option>
                        <option value="nai-diffusion-4-5-curated" ${settings.naiConfig?.model === "nai-diffusion-4-5-curated" ? "selected" : ""}>NAI Diffusion V4.5 Curated</option>
                        <option value="nai-diffusion-4-full" ${settings.naiConfig?.model === "nai-diffusion-4-full" ? "selected" : ""}>NAI Diffusion V4 Full</option>
                        <option value="nai-diffusion-4-curated-preview" ${settings.naiConfig?.model === "nai-diffusion-4-curated-preview" ? "selected" : ""}>NAI Diffusion V4 Curated</option>
                        <option value="nai-diffusion-3" ${settings.naiConfig?.model === "nai-diffusion-3" ? "selected" : ""}>NAI Diffusion V3</option>
                    </select>

                    <label>해상도</label>
                    <select id="ds-nai-size" class="text_pole">
                        <option value="832x1216">832×1216 (세로 - 캐릭터 추천)</option>
                        <option value="1024x1024">1024×1024 (정사각)</option>
                        <option value="1216x832">1216×832 (가로)</option>
                        <option value="512x768">512×768 (작게)</option>
                    </select>

                    <label>스텝 — <span id="ds-nai-steps-val">${settings.naiConfig?.steps ?? 28}</span></label>
                    <input id="ds-nai-steps" type="range" min="20" max="50" step="1"
                        value="${settings.naiConfig?.steps ?? 28}" class="ds-slider">

                    <label>프롬프트 가이던스 — <span id="ds-nai-scale-val">${settings.naiConfig?.scale ?? 5}</span></label>
                    <input id="ds-nai-scale" type="range" min="1" max="10" step="0.5"
                        value="${settings.naiConfig?.scale ?? 5}" class="ds-slider">

                    <label>Prompt Guidance Rescale — <span id="ds-nai-rescale-val">${settings.naiConfig?.cfgRescale ?? 0}</span></label>
                    <input id="ds-nai-rescale" type="range" min="0" max="1" step="0.05"
                        value="${settings.naiConfig?.cfgRescale ?? 0}" class="ds-slider">

                    <label class="checkbox_label" style="margin-top:8px;">
                        <input id="ds-nai-seed-lock" type="checkbox" ${settings.naiConfig?.seedLocked ? "checked" : ""}>
                        <span>시드 고정 (일관된 캐릭터 표정 세트)</span>
                    </label>
                    <div id="ds-nai-seed-row" style="display:${settings.naiConfig?.seedLocked ? "flex" : "none"}; gap:6px; margin-top:4px; align-items:center;">
                        <input type="number" id="ds-nai-locked-seed" class="text_pole"
                            value="${settings.naiConfig?.lockedSeed ?? -1}" min="-1" max="4294967295"
                            placeholder="-1 (자동)" style="flex:1;">
                        <button id="ds-nai-seed-random" class="menu_button" title="랜덤 시드 생성">랜덤</button>
                    </div>

                    <label class="checkbox_label" style="margin-top:8px;">
                        <input id="ds-nai-auto-bg" type="checkbox" ${settings.naiConfig?.autoRemoveBg ? "checked" : ""}>
                        <span>배경 제거 (흰 배경 투명화)</span>
                    </label>
                    <div id="ds-nai-bg-row" style="display:${settings.naiConfig?.autoRemoveBg ? "block" : "none"}; margin-top:4px;">
                        <label>임계값 — <span id="ds-nai-bg-thresh-val">${settings.naiConfig?.removeBgThreshold ?? 240}</span></label>
                        <input id="ds-nai-bg-thresh" type="range" min="200" max="255" step="1"
                            value="${settings.naiConfig?.removeBgThreshold ?? 240}" class="ds-slider">
                    </div>

                    <button id="ds-nai-test" class="menu_button" style="margin-top:10px;">NAI 연결 테스트 (1장 생성)</button>
                    <div id="ds-nai-test-result" style="margin-top:8px; font-size:0.88em;"></div>

                    <hr>
                    <h4><i class="fa-solid fa-palette ds-h4-icon"></i>그림체 프롬프트</h4>
                    <label>긍정 프롬프트</label>
                    <p class="ds-hint">화풍/품질 태그. 모든 생성에 앞에 붙음.</p>
                    <textarea id="ds-nai-style-prompt" class="text_pole" rows="2"
                        placeholder="masterpiece, best quality, anime style, ...">${settings.naiConfig?.stylePrompt ?? ""}</textarea>

                    <label>네거티브 프롬프트</label>
                    <textarea id="ds-nai-style-neg" class="text_pole" rows="2"
                        placeholder="worst quality, lowres, ...">${settings.naiConfig?.styleNegPrompt ?? ""}</textarea>

                    <hr>
                    <h4><i class="fa-solid fa-user-pen ds-h4-icon"></i>캐릭터 프롬프트</h4>
                    <label>베이스 프롬프트</label>
                    <p class="ds-hint">캐릭터 고정 외모/의상</p>
                    <textarea id="ds-nai-base-prompt" class="text_pole" rows="3"
                        placeholder="1girl, ..."></textarea>

                    <label>네거티브 프롬프트</label>
                    <textarea id="ds-nai-neg-prompt" class="text_pole" rows="2"
                        placeholder="(비워두면 기본값 사용)"></textarea>

                    <hr>
                    <h4><i class="fa-solid fa-bolt ds-h4-icon"></i>단일 생성</h4>
                    <p class="ds-hint">첫 번째 칸은 표정 가중치, 두 번째 칸은 표정 — <code>가중치::label::</code> 형태로 전송</p>
                    <div style="display:flex; gap:6px; align-items:center;">
                        <input type="number" id="ds-nai-label-intensity" class="text_pole"
                            value="${settings.naiConfig?.labelIntensity ?? 2}"
                            min="0.1" max="10" step="0.5" style="width:64px; flex-shrink:0;">
                        <input type="text" id="ds-nai-quick-label" class="text_pole"
                            placeholder="라벨명 (예: hurt)" style="flex:1;">
                        <button id="ds-nai-quick-gen" class="menu_button">생성</button>
                    </div>
                    <div id="ds-nai-quick-result" style="margin-top:6px; font-size:0.85em; min-height:14px;"></div>
                </div>

                <!-- ============================================================
                     Tab: 분석 (감정 분석용 API / 캐릭터 성격 / 테스트)
                ============================================================ -->
                <div class="ds-tab-panel" data-tab="analyze" hidden>
                    <h4><i class="fa-solid fa-bolt ds-h4-icon"></i>감정 분석용 API</h4>
                    <p class="ds-hint">본문 생성과 별도로 빠른 모델 사용 가능.</p>

                    <label>API 모드</label>
                    <select id="ds-api-mode" class="text_pole">
                        <option value="st" ${settings.apiMode === "st" ? "selected" : ""}>본문 생성 API 재사용 (기본)</option>
                        <option value="st_profile" ${settings.apiMode === "st_profile" ? "selected" : ""}>ST의 다른 Connection Profile 사용 ⭐</option>
                        <option value="gemini" ${settings.apiMode === "gemini" ? "selected" : ""}>Gemini API 키 직접</option>
                        <option value="openai_compat" ${settings.apiMode === "openai_compat" ? "selected" : ""}>OpenAI 호환 (OpenRouter 등)</option>
                    </select>

                    <div id="ds-api-st-hint" class="ds-hint" style="margin-top:8px;">
                        <span>ST 현재 연결된 API를 그대로 사용. 추가 설정 불필요.</span>
                    </div>

                    <div id="ds-api-profile-field" style="display:none;">
                        <label>분석용 Connection Profile</label>
                        <select id="ds-api-profile" class="text_pole"></select>
                        <p class="ds-hint">⭐ 추천: ST에서 "Quick-Classify" 같은 프로필 미리 만들어두기 (Gemini 2.5 Flash나 DeepSeek 추천).<br>
                        본문 생성 끝난 뒤 일시적으로 이 프로필로 전환해서 분석함.</p>
                        <button id="ds-refresh-profiles" class="menu_button">프로필 목록 새로고침</button>
                    </div>

                    <div id="ds-api-key-field" style="display:none;">
                        <label id="ds-api-key-label">API 키</label>
                        <div class="ds-key-input-wrap">
                            <input type="password" id="ds-api-key" class="text_pole"
                                value="${settings.apiKey || ""}" autocomplete="off">
                            <button type="button" id="ds-key-toggle" class="menu_button" title="키 표시/숨김">보기</button>
                        </div>
                    </div>

                    <div id="ds-api-endpoint-field" style="display:none;">
                        <label>API 엔드포인트</label>
                        <input type="text" id="ds-api-endpoint" class="text_pole"
                            placeholder="https://openrouter.ai/api/v1"
                            value="${settings.apiEndpoint || ""}">
                    </div>

                    <div id="ds-api-presets-field" style="display:none;">
                        <label>빠른 설정</label>
                        <div id="ds-api-presets" class="ds-presets"></div>
                    </div>

                    <div id="ds-api-model-field" style="display:none;">
                        <label id="ds-api-model-label">모델명</label>
                        <input type="text" id="ds-api-model" class="text_pole"
                            placeholder="모델명을 직접 입력"
                            value="${settings.apiModel || ""}">
                    </div>

                    <button id="ds-api-test" class="menu_button" style="margin-top:10px;">API 연결 테스트</button>
                    <div id="ds-api-test-result"></div>

                    <hr>
                    <h4><i class="fa-solid fa-brain ds-h4-icon"></i>캐릭터 성격 / 분석 지침</h4>
                    <p class="ds-hint">캐릭터의 표현 방식을 설명하면 감정 분류 정확도가 올라갑니다.<br>예: "이 캐릭터는 무뚝뚝하게 말해도 화난 게 아님. 명확한 신호 없으면 neutral 우선"</p>
                    <textarea id="ds-custom-prompt" class="text_pole" rows="3"
                        placeholder="예: 이 character는 무뚝뚝하고 감정 표현을 절제하는 성격. 명확한 신호 없을 때는 neutral 우선.">${settings.customPrompt || ""}</textarea>

                    <label>유저와의 관계 / 맥락 <span style="opacity:.6;">(선택)</span></label>
                    <p class="ds-hint">둘의 관계나 대화 분위기를 적으면 맥락을 반영한 분류가 됩니다.<br>예: "둘은 오랜 친구. 퉁명스럽거나 '넌 진짜' 같은 말도 장난일 수 있음"</p>
                    <textarea id="ds-relation-context" class="text_pole" rows="2"
                        placeholder="예: 캐릭터와 유저는 연인. 날카로운 말투도 애정 표현일 수 있음.">${settings.relationContext || ""}</textarea>

                    <hr>
                    <h4><i class="fa-solid fa-flask ds-h4-icon"></i>분석 테스트</h4>
                    <textarea id="ds-test-input" class="text_pole" rows="2"
                        placeholder="테스트할 캐릭터 대사 입력"></textarea>
                    <button id="ds-test-btn" class="menu_button" style="margin-top:6px;">분석 실행</button>
                    <div id="ds-test-result"></div>
                </div>

                <!-- ============================================================
                     Tab: 설정 (테마 / 알림 / 액션)
                ============================================================ -->
                <div class="ds-tab-panel" data-tab="settings" hidden>
                    <h4><i class="fa-solid fa-palette ds-h4-icon"></i>테마</h4>
                    <div class="ds-theme-picker">
                        <button class="ds-theme-btn" data-theme="mono"  title="Mono (흑백)"></button>
                        <button class="ds-theme-btn" data-theme="rose"  title="Rose (로즈)"></button>
                        <button class="ds-theme-btn" data-theme="ivory" title="Ivory (아이보리)"></button>
                        <button class="ds-theme-btn" data-theme="sky"   title="Sky (스카이)"></button>
                    </div>

                    <hr>
                    <h4><i class="fa-solid fa-bell ds-h4-icon"></i>알림</h4>
                    <label class="checkbox_label">
                        <input id="ds-notify-char-change" type="checkbox" ${settings.notifyCharChange !== false ? "checked" : ""}>
                        <span>캐릭터 변경 시 알림 표시</span>
                    </label>

                    <hr>
                    <h4><i class="fa-solid fa-database ds-h4-icon"></i>데이터 관리</h4>
                    <div class="ds-actions-row">
                        <button id="ds-refresh" class="menu_button">리스트 새로고침</button>
                        <button id="ds-export" class="menu_button">백업</button>
                        <button id="ds-import-btn" class="menu_button">복원</button>
                        <input type="file" id="ds-import-input" accept=".json" style="display:none;">
                    </div>
                </div>

            </div>
        </div>
    </div>`;
}
