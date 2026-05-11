// Use native fetch

async function test() {
  try {
    console.log("Logging in...");
    const loginRes = await fetch("http://localhost:8080/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@cima.dev", password: "Admin123!" })
    });
    const loginData = await loginRes.json();
    console.log("Login res:", JSON.stringify(loginData).substring(0, 100));
    
    const token = loginData.data?.access_token || loginData.access_token;
    if (!token) {
        console.log("No token found in response.");
        return;
    }

    const collabRes = await fetch("http://localhost:8080/collab/projects", {
      headers: { "Authorization": `Bearer ${token}` }
    });
    const collabData = await collabRes.json();
    console.log("Collab response:", JSON.stringify(collabData).substring(0, 500));
    console.log("Projects:", dashData.projects ? Object.keys(dashData.projects) : "undefined");
    console.log("Projects data:", JSON.stringify(dashData).substring(0, 500));
  } catch (err) {
    console.error(err);
  }
}
test();
