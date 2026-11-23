const label = document.getElementById('version')

async function showLatestVersion() {
  try {
    const response = await fetch('https://api.github.com/repos/vv1sion/vClip/releases/latest', { headers: { Accept: 'application/vnd.github+json' } })
    if (!response.ok) return
    const release = await response.json()
    if (typeof release.tag_name === 'string' && /^v\d+\.\d+\.\d+$/.test(release.tag_name)) label.textContent = `Version ${release.tag_name.slice(1)}`
  } catch (e) {
    console.warn('could not read the latest version', e)
  }
}

showLatestVersion()
