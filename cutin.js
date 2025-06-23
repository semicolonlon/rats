function cutin(title, subtitle, type) {
  const element = document.querySelector(".cutinWrapper");
  const titleElement = element.querySelector(".cutinTitle");
  const subtitleElement = element.querySelector(".cutinSubtitle");
  const img = element.querySelector(".cutinImg")
  element.classList.add("express");

  if (titleElement) {
    titleElement.textContent = title;
  }
  if (subtitleElement) {
    subtitleElement.textContent = subtitle;
  }

  if (img&&imgUrl) {
    let imgUrl = "";
    switch (type) {
      case "killedInformation":
        imgUrl = "assets/rat.png";
        break;

      default:
        imgUrl = "";
    }
    img.src = imgUrl;
  }
}

document.addEventListener("DOMContentLoaded", function () {
  const exitButton = document.querySelector(".exitButton");
  const cutinWrapper = document.querySelector(".cutinWrapper");

  exitButton.addEventListener("click", function () {
    cutinWrapper.classList.remove("express");
  });
});