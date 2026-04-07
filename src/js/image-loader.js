export class ImageLoader {
  constructor(fileInput) {
    this._fileInput = fileInput;
    this._onLoad = null;
  }

  set onLoad(callback) {
    this._onLoad = callback;
  }

  init() {
    this._fileInput.addEventListener("change", (e) => this._handleFile(e));
  }

  async _handleFile(event) {
    const file = event.target.files[0];
    if (!file) {
      return;
    }

    event.target.value = "";

    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch (err) {
      console.error("Не удалось загрузить изображение:", err);
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
    bitmap.close();

    if (this._onLoad) {
      this._onLoad(canvas);
    }
  }
}
