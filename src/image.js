// ====================================================================
// 이미지 유틸 — 순수 함수
// ====================================================================

// 파일명 → 라벨 ("SPR_캐릭터명_라벨.png" → "라벨")
export function extractEmotionFromFilename(filename) {
    let name = filename.replace(/\.(png|jpg|jpeg|webp|gif)$/i, "");
    name = name.replace(/^SPR_[^_]+_/i, "");
    return name.toLowerCase();
}

// 이미지 압축 — 가로/세로 중 큰 쪽을 maxDim에 맞춰 리사이즈, WebP로 저장
// (원본보다 커지면 원본 그대로 반환)
export async function compressImage(file, maxDim = 800, quality = 0.85) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(url);
            const { width, height } = img;
            const ratio = Math.min(maxDim / width, maxDim / height, 1);
            if (ratio >= 1) {
                resolve(file);
                return;
            }
            const newW = Math.round(width * ratio);
            const newH = Math.round(height * ratio);
            const canvas = document.createElement("canvas");
            canvas.width = newW;
            canvas.height = newH;
            const ctx = canvas.getContext("2d");
            ctx.imageSmoothingQuality = "high";
            ctx.drawImage(img, 0, 0, newW, newH);

            canvas.toBlob(blob => {
                if (!blob) { resolve(file); return; }
                resolve(blob.size < file.size ? blob : file);
            }, "image/webp", quality);
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("이미지 로드 실패"));
        };
        img.src = url;
    });
}

// NAI ZIP 응답에서 첫 번째 이미지 추출
// Central Directory 기준 파싱 — data descriptor 방식(EOCD bit 3)도 정상 처리
export async function extractImageFromNaiZip(arrayBuffer) {
    const view = new DataView(arrayBuffer);

    // 1) End of Central Directory (EOCD) 탐색 (뒤에서부터)
    let eocdOffset = -1;
    for (let i = view.byteLength - 22; i >= 0; i--) {
        if (view.getUint32(i, true) === 0x06054b50) { eocdOffset = i; break; }
    }
    if (eocdOffset < 0) throw new Error("NAI ZIP: EOCD 없음 (응답이 ZIP이 아닐 수 있음)");

    // 2) Central Directory에서 파일 정보 읽기 (Local Header는 data descriptor 때문에 부정확)
    const cdOffset = view.getUint32(eocdOffset + 16, true);
    if (view.getUint32(cdOffset, true) !== 0x02014b50) throw new Error("NAI ZIP: Central Directory 파싱 실패");
    const compressionMethod = view.getUint16(cdOffset + 10, true);
    const compressedSize    = view.getUint32(cdOffset + 20, true);
    const localHeaderOffset = view.getUint32(cdOffset + 42, true);

    // 3) Local File Header에서 실제 데이터 오프셋 계산
    if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) throw new Error("NAI ZIP: Local Header 파싱 실패");
    const fnLen    = view.getUint16(localHeaderOffset + 26, true);
    const extraLen = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + fnLen + extraLen;

    const compressed = new Uint8Array(arrayBuffer, dataStart, compressedSize);

    if (compressionMethod === 0) {
        return new Blob([compressed], { type: "image/png" });
    }
    if (compressionMethod === 8) {
        const ds = new DecompressionStream("deflate-raw");
        const writer = ds.writable.getWriter();
        writer.write(compressed);
        writer.close();
        return new Response(ds.readable).blob();
    }
    throw new Error(`NAI ZIP: 지원하지 않는 압축 방식 (method=${compressionMethod})`);
}

// 흰 배경 제거 — 이미지 테두리에서 BFS 플러드 필
// 테두리와 이어진 흰 픽셀만 투명화 (내부 흰 픽셀 — 흰 옷 등 — 은 보존)
export async function removeWhiteBackground(blob, threshold = 240) {
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = imageData.data;
    const w = canvas.width, h = canvas.height;
    const visited = new Uint8Array(w * h);
    const queue = [];

    const isWhite = (i) => d[i] >= threshold && d[i + 1] >= threshold && d[i + 2] >= threshold;
    const seed = (x, y) => {
        const idx = y * w + x;
        if (!visited[idx] && isWhite(idx * 4)) { visited[idx] = 1; queue.push(idx); }
    };
    for (let x = 0; x < w; x++) { seed(x, 0); seed(x, h - 1); }
    for (let y = 0; y < h; y++) { seed(0, y); seed(w - 1, y); }

    let qi = 0;
    while (qi < queue.length) {
        const idx = queue[qi++];
        d[idx * 4 + 3] = 0;
        const x = idx % w, y = (idx / w) | 0;
        for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
            if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                const ni = ny * w + nx;
                if (!visited[ni] && isWhite(ni * 4)) { visited[ni] = 1; queue.push(ni); }
            }
        }
    }
    ctx.putImageData(imageData, 0, 0);
    return await canvas.convertToBlob({ type: "image/png" });
}
