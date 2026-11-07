# 独奢 · 手链 AR 试戴测试页 0.1

网页版试戴可行性测试：在手机浏览器（含微信内置浏览器）里打开摄像头，用 MediaPipe Hands 识别手部 21 个关键点，把手链画到手腕上，并按手的 3D 方向跟着手腕转动。

- 识别在手机本地运行，画面不上传。
- 首次打开需要下载约 10MB 的模型文件。
- `app.js` 由 `src/main.js` 打包生成（esbuild）；手链排布和绘制沿用小程序原型的 tryon-core / tryon-render。

## 第三方组件

- `mediapipe/`：MediaPipe Hands 0.4.1675469240（Google），Apache License 2.0，许可证全文见 `mediapipe/LICENSE`。文件未做修改。
- `beads/`：珠子图片，独奢所有。
