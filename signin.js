function getCookie(name) {
  const match = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
  return match ? match.pop() : null;
}

function setCookie(name, value, days) {
  const expires = new Date();
  expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);
  document.cookie = `${name}=${value}; expires=${expires.toUTCString()}; path=/`;
}

document.addEventListener("DOMContentLoaded", () => {
  const deviceId = getCookie("user_id");
  if (deviceId) {
    fetch(`/api/users/${encodeURIComponent(deviceId)}/exists`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to check user existence");
        return res.json();
      })
      .then((data) => {
        if (data.success && data.exists) {
          window.location.href = "waiting.html"; // Redirect to main page if user exists
        }
      })
      .catch((err) => {
        console.error("Error checking user existence:", err);
      });
  }
});

document
  .getElementById("loginForm")
  .addEventListener("submit", async function (e) {
    e.preventDefault();

    const usernameInput = document.getElementById("username");
    const name = usernameInput.value.trim();
    if (!name) {
      alert("Please enter a username");
      return;
    }

    let deviceId = getCookie("user_id");
    if (!deviceId) {
      deviceId = "user-" + Math.random().toString(36).substring(2, 10);
      setCookie("user_id", deviceId, 30); // Store for 30 days
    }

    const color = `hsl(${Math.floor(Math.random() * 360)}, 100%, 50%)`;

    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          deviceId,
          name,
          color,
        }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        // ユーザーが登録されたことを確認してからタスクを割り当てる
        const userCheckRes = await fetch(
          `/api/users/${encodeURIComponent(deviceId)}/exists`
        );
        const userCheckData = await userCheckRes.json();

        if (userCheckRes.ok && userCheckData.success && userCheckData.exists) {
          const taskRes = await fetch(
            `/api/tasks/${encodeURIComponent(deviceId)}`,
            {
              method: "POST",
            }
          );
          const taskData = await taskRes.json();

          if (taskRes.ok && taskData.success) {
            window.location.href = "index.html";
          } else {
            alert(
              "Failed to assign tasks: " + (taskData.message || "Unknown error")
            );
          }
        } else {
          alert("Failed to verify user existence.");
        }
      } else {
        alert("Failed login: " + (data.message || "Unknown error"));
      }
    } catch (err) {
      console.error("Error during login:", err);
      alert("Error during login: " + err.message);
    }
  });
