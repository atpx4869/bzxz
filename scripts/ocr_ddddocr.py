import sys
import base64
import ddddocr

sys.stdin.reconfigure(encoding='utf-8')

def main():
    raw = sys.stdin.buffer.read().strip()
    if not raw:
        print("", flush=True)
        return

    try:
        image_bytes = base64.b64decode(raw)
    except Exception:
        print("", flush=True)
        return

    ocr = ddddocr.DdddOcr(show_ad=False)
    try:
        result = ocr.classification(image_bytes)
    except Exception:
        result = ""

    print(result.strip(), flush=True)


if __name__ == '__main__':
    main()
