// Client-side image helpers — same pipeline used in the Sermons and
// Pastoral Records apps. We always decode → optionally downscale →
// re-encode as JPEG so Anthropic vision (and any browser later) can
// read the bytes back, and so we never store a stale File reference
// that the OS can rescind out from under us (see the "file could not be
// read" bug we hit on mobile in the Sermons app).

async function decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      // fall through to <img> fallback
    }
  }
  return await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(
        new Error(
          `Browser couldn't decode "${file.type || 'unknown format'}".`
        )
      );
    };
    img.src = url;
  });
}

export async function prepareImageForUpload(
  file,
  maxDim = 1600,
  quality = 0.85
) {
  let source;
  try {
    source = await decodeImage(file);
  } catch (decodeErr) {
    throw new Error(
      `Couldn't read this image (${file.type || 'unknown format'}). ` +
        `Some phone photo formats (like HEIC) aren't supported on every ` +
        `browser. Try the Camera button (which saves as JPEG), or save ` +
        `the picture in your gallery as JPEG/PNG before uploading.`
    );
  }

  const w = source.width || source.naturalWidth || 0;
  const h = source.height || source.naturalHeight || 0;
  if (!w || !h) {
    throw new Error('Decoded image has zero dimensions — the file may be corrupted.');
  }

  let nw = w;
  let nh = h;
  const longer = Math.max(w, h);
  if (longer > maxDim) {
    const ratio = maxDim / longer;
    nw = Math.round(w * ratio);
    nh = Math.round(h * ratio);
  }

  const canvas = document.createElement('canvas');
  canvas.width = nw;
  canvas.height = nh;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(source, 0, 0, nw, nh);

  if (typeof source.close === 'function') {
    try {
      source.close();
    } catch {
      /* noop */
    }
  }

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) =>
        b
          ? resolve(b)
          : reject(new Error('Canvas toBlob returned null — out of memory?')),
      'image/jpeg',
      quality
    );
  });

  return { blob, mediaType: 'image/jpeg' };
}

// Rotate an existing JPEG/PNG/etc blob 90° clockwise and re-encode as JPEG.
// Used for the rotate button on attached images.
export async function rotateImageBlob90CW(blob, quality = 0.9) {
  const source = await decodeImage(blob);
  const w = source.width || source.naturalWidth || 0;
  const h = source.height || source.naturalHeight || 0;
  if (!w || !h) {
    throw new Error('Decoded image has zero dimensions — cannot rotate.');
  }
  // Rotated canvas swaps width/height.
  const canvas = document.createElement('canvas');
  canvas.width = h;
  canvas.height = w;
  const ctx = canvas.getContext('2d');
  ctx.translate(h, 0);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(source, 0, 0, w, h);
  if (typeof source.close === 'function') {
    try {
      source.close();
    } catch {
      /* noop */
    }
  }
  return await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) =>
        b
          ? resolve(b)
          : reject(new Error('Canvas toBlob returned null — out of memory?')),
      'image/jpeg',
      quality
    );
  });
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error('Read failed.'));
    reader.readAsDataURL(blob);
  });
}

// Quick stable content hash used to dedupe images on re-upload. Not a
// cryptographic hash — just a SHA-256 of the bytes.
export async function fileHash(blob) {
  const buf = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}
