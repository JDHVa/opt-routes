export const CHEVRON_IMAGE_ID = "route-chevron";

const SIZE = 32;

export function createChevronImage(): ImageData | null {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.clearRect(0, 0, SIZE, SIZE);
  context.strokeStyle = "white";
  context.lineWidth = 5;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  context.moveTo(11, 7);
  context.lineTo(21, 16);
  context.lineTo(11, 25);
  context.stroke();
  return context.getImageData(0, 0, SIZE, SIZE);
}
