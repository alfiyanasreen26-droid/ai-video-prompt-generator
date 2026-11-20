
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/generate" && request.method === "POST") {
      return generateVideo(request, env);
    }

    if (url.pathname.startsWith("/api/status/") && request.method === "GET") {
      return checkStatus(url.pathname.split("/").pop(), env);
    }

    return env.ASSETS.fetch(request);
  }
};

async function generateVideo(request, env) {
  try {
    if (!env.MAGIC_HOUR_API_KEY) {
      return json({ error: "API key is missing in Cloudflare." }, 500);
    }

    const form = await request.formData();
    const image = form.get("image");
    const prompt = String(form.get("prompt") || "").trim();

    if (!(image instanceof File) || !image.type.startsWith("image/")) {
      return json({ error: "Please upload an image." }, 400);
    }

    if (!prompt) {
      return json({ error: "Please enter a video prompt." }, 400);
    }

    const extension = image.name.split(".").pop().toLowerCase();

    const upload = await fetch(
      "https://api.magichour.ai/v1/files/upload-urls",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.MAGIC_HOUR_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          items: [{ type: "image", extension }]
        })
      }
    );

    const uploadData = await upload.json();

    if (!upload.ok) {
      return json({ error: "Image upload preparation failed.", details: uploadData }, upload.status);
    }

    const item = uploadData.items?.[0];

    if (!item?.upload_url || !item?.file_path) {
      return json({ error: "Invalid upload response from Magic Hour." }, 502);
    }

    const sent = await fetch(item.upload_url, {
      method: "PUT",
      headers: { "Content-Type": image.type },
      body: image
    });

    if (!sent.ok) {
      return json({ error: "Image upload failed." }, 502);
    }

    const video = await fetch(
      "https://api.magichour.ai/v1/image-to-video",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.MAGIC_HOUR_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          assets: { image_file_path: item.file_path },
          end_seconds: 5,
          resolution: "480p",
          style: { prompt }
        })
      }
    );

    const data = await video.json();

    if (!video.ok) {
      return json({ error: "Video generation could not start.", details: data }, video.status);
    }

    return json({ id: data.id, credits_charged: data.credits_charged });
  } catch (error) {
    return json({ error: error.message || "Something went wrong." }, 500);
  }
}

async function checkStatus(id, env) {
  const response = await fetch(
    `https://api.magichour.ai/v1/video-projects/${encodeURIComponent(id)}`,
    {
      headers: {
        Authorization: `Bearer ${env.MAGIC_HOUR_API_KEY}`
      }
    }
  );

  const data = await response.json();

  return json(data, response.status);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
