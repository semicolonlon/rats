function getCookieValue(name) {
  return document.cookie
    .split('; ')
    .find(row => row.startsWith(name + '='))
    ?.split('=')[1] || null;
}

async function fetchMyUserInfo() {
  const deviceId = decodeURIComponent(getCookieValue('user_id'));
  if(deviceId){
    throw new Error('user is not signed in');
  }

  const res = await fetch(`/api/fetch/${deviceId}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json'
    }
  });

  if(!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'HTTP error');
  }

  const {user} = await res.json();
  return user;
}

