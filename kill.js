const { get } = require("http");
const {
  getAllUsers,
  getNearbyUsers,
  hasNearbyUsers,
} = require("./JS/database.js");



// 20m以内に人がいるかチェックする例
async function checkNearbyUsers() {
  try {
    console.log("\n周りに人がいるかチェック");
    
    const users = await getAllUsers();
    console.log(`総ユーザー数: ${users.length}`);
    
    for (const user of users) {
      console.log(`\n ${user.name} (${user.device_id}) の周辺チェック `);
      console.log(`位置: ${user.position}`);
      
      // 20m以内に人がいるかチェック
      const hasNearby20m = await hasNearbyUsers(user.device_id, 20);
      console.log(`20m以内に人がいる: ${hasNearby20m}`);
      
      // 詳細な近くのユーザー情報を取得
      const position = JSON.parse(user.position);
      const nearbyUsers20m = await getNearbyUsers(position.lat, position.lng, 20);
      
      console.log(`20m以内のユーザー数: ${nearbyUsers20m.length}`);
      
      if (nearbyUsers20m.length > 0) {
        console.log("20m以内のユーザー:", nearbyUsers20m.map(u => u.name).join(", "));
      }
    }
  } catch (err) {
    console.error("Error:", err);
  }
}
checkNearbyUsers();