const { getAllUsers, getAllTasks } = require("./JS/database");

async function checkGameResult() {
  const users = await getAllUsers();
  const aliveWolves = users.fillter(
    (user) => user.role === "marder" && user.alive
  ).length;
  const aliveVillagers = users.filter(
    (user) => user.role === "villager" && user.alive
  ).length;

  if (aliveWolves >= aliveCitizens) {
    return "wolves";
  }

  const allTasks = await getAllTasks();
  const allDone = allTasks.length > 0 && allTasks.every((t) => t.isDone);

  if (allDone) {
    return "villagers";
  }

  return "none";
}

(async () => {
  const result = await checkGameResult();
  console.log("Game Result:", result);
})();
