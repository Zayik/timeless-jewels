// On-device OCR via Windows.Media.Ocr — no bundled binaries or model files (the
// overlay is Windows-only, so the OS engine is free, fast, and accurate on crisp
// rendered game text). We only need the tooltip's name line; the caller fuzzy-matches
// it against the jewel's closed result-notable vocabulary.

use windows::{
    Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap},
    Media::Ocr::OcrEngine,
    Storage::Streams::DataWriter,
    Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED},
};

/// One recognised text line and its bounding-box centre, in pixels relative to the
/// buffer passed to `recognize` (the caller adds the crop origin to get frame coords).
#[derive(serde::Serialize, Clone)]
pub struct OcrLine {
    pub text: String,
    pub cx: f64,
    pub cy: f64,
}

/// Recognise text in a BGRA8 image buffer (`w * h * 4` bytes, row-major, no padding).
/// Returns one `OcrLine` per detected line. Errors carry the failing WinRT step so a
/// missing OCR language pack or an init failure is diagnosable from the UI.
pub fn recognize(bgra: &[u8], w: u32, h: u32) -> Result<Vec<OcrLine>, String> {
    if w == 0 || h == 0 {
        return Ok(Vec::new());
    }
    let expected = (w as usize) * (h as usize) * 4;
    if bgra.len() < expected {
        return Err(format!("buffer too small: {} < {expected}", bgra.len()));
    }

    // WinRT calls need an initialised apartment. Best-effort and idempotent: a thread
    // already in an apartment returns S_FALSE / RPC_E_CHANGED_MODE, which is fine — the
    // existing apartment still serves the OCR calls.
    unsafe {
        let _ = RoInitialize(RO_INIT_MULTITHREADED);
    }

    // Wrap the bytes in an IBuffer, then build a BGRA8 SoftwareBitmap (the format the
    // OCR engine expects).
    let writer = DataWriter::new().map_err(|e| format!("DataWriter: {e}"))?;
    writer.WriteBytes(bgra).map_err(|e| format!("WriteBytes: {e}"))?;
    let buffer = writer.DetachBuffer().map_err(|e| format!("DetachBuffer: {e}"))?;
    let bitmap =
        SoftwareBitmap::CreateCopyFromBuffer(&buffer, BitmapPixelFormat::Bgra8, w as i32, h as i32)
            .map_err(|e| format!("CreateCopyFromBuffer: {e}"))?;

    let engine = OcrEngine::TryCreateFromUserProfileLanguages()
        .map_err(|e| format!("no OCR language available: {e}"))?;
    let result = engine
        .RecognizeAsync(&bitmap)
        .map_err(|e| format!("RecognizeAsync: {e}"))?
        .get()
        .map_err(|e| format!("OCR await: {e}"))?;

    let lines = result.Lines().map_err(|e| format!("Lines: {e}"))?;
    let line_count = lines.Size().map_err(|e| format!("Lines.Size: {e}"))?;
    let mut out = Vec::with_capacity(line_count as usize);
    for i in 0..line_count {
        let line = lines.GetAt(i).map_err(|e| format!("Lines.GetAt: {e}"))?;
        let text = line.Text().map_err(|e| format!("Text: {e}"))?.to_string();
        if text.trim().is_empty() {
            continue;
        }
        // Union the words' bounding rects for the line centre.
        let words = line.Words().map_err(|e| format!("Words: {e}"))?;
        let word_count = words.Size().map_err(|e| format!("Words.Size: {e}"))?;
        let (mut min_x, mut min_y, mut max_x, mut max_y) =
            (f32::MAX, f32::MAX, f32::MIN, f32::MIN);
        for j in 0..word_count {
            let r = words
                .GetAt(j)
                .map_err(|e| format!("Words.GetAt: {e}"))?
                .BoundingRect()
                .map_err(|e| format!("BoundingRect: {e}"))?;
            min_x = min_x.min(r.X);
            min_y = min_y.min(r.Y);
            max_x = max_x.max(r.X + r.Width);
            max_y = max_y.max(r.Y + r.Height);
        }
        if word_count == 0 {
            continue;
        }
        out.push(OcrLine {
            text,
            cx: ((min_x + max_x) / 2.0) as f64,
            cy: ((min_y + max_y) / 2.0) as f64,
        });
    }
    Ok(out)
}
