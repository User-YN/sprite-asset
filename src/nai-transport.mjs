const BRIDGE = '/api/plugins/sharednai-bridge';

export function usesSharedNAI(config, bridgeSettings) {
    const provider = config?.provider || 'auto';
    return provider === 'sharednai' || (provider === 'auto' && bridgeSettings?.enabled === true);
}

export function hasImageConnection(config, bridgeSettings) {
    return usesSharedNAI(config, bridgeSettings) || !!config?.apiKey;
}

async function checkResponse(response, shared) {
    if (response.ok) return;
    let message = `${shared ? 'SharedNAI' : 'NAI'} HTTP ${response.status}`;
    if (shared) {
        if (response.status === 404) message = 'SharedNAI 서버 플러그인을 설치하고 SillyTavern을 재시작하세요.';
        else if (response.status === 401) message = 'SharedNAI 연결 확장에서 계정을 다시 연결하세요.';
        else {
            try {
                const data = await response.json();
                if (typeof data.message === 'string') message += `: ${data.message.slice(0, 300)}`;
            } catch { /* Non-JSON server error. */ }
        }
    }
    const error = new Error(message);
    error.status = response.status;
    throw error;
}

export async function requestNaiImage(body, config, bridgeSettings, { getRequestHeaders, extractZip, fetchImpl = globalThis.fetch }) {
    const shared = usesSharedNAI(config, bridgeSettings);
    if (!shared && !config?.apiKey) throw new Error('NAI API 키를 입력하거나 SharedNAI 연결을 활성화하세요.');
    if (shared) {
        const headers = new Headers(getRequestHeaders());
        headers.delete('Authorization');
        headers.set('Content-Type', 'application/json');
        const status = await fetchImpl(`${BRIDGE}/status`, { headers, credentials: 'same-origin', cache: 'no-store' });
        await checkResponse(status, true);
        if ((await status.json()).connected !== true) {
            throw new Error('SharedNAI 연결 확장에서 계정을 먼저 연결하세요.');
        }
        // The bridge accepts flat SillyTavern parameters, not NovelAI's nested payload.
        const response = await fetchImpl(`${BRIDGE}/generate`, {
            method: 'POST', headers, credentials: 'same-origin',
            body: JSON.stringify({ ...body.parameters, model: body.model, prompt: body.input }),
        });
        await checkResponse(response, true);
        const base64 = (await response.text()).trim();
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new Error('SharedNAI 이미지 응답 형식이 올바르지 않습니다.');
        const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
        const png = [137, 80, 78, 71, 13, 10, 26, 10];
        if (!png.every((value, i) => bytes[i] === value)) throw new Error('SharedNAI가 PNG 이미지를 반환하지 않았습니다.');
        return new Blob([bytes], { type: 'image/png' });
    }
    const response = await fetchImpl('https://image.novelai.net/ai/generate-image', {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', Accept: 'application/x-zip-compressed' },
        body: JSON.stringify(body),
    });
    await checkResponse(response, false);
    return extractZip(await response.arrayBuffer());
}
