exports.handler = async (event) => {
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const { content } = JSON.parse(event.body);

  const githubUsername = 'BirdHau5';
  const repoName = 'sketcher';
  const folderPath = 'json';
  const branch = 'main';

  const githubUrl = `https://api.github.com/repos/${githubUsername}/${repoName}/contents/${folderPath}`;

  try {
    // Step 1: Fetch the list of JSON files in the folder
    const filesResponse = await fetch(githubUrl, {
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    if (!filesResponse.ok) {
      return {
        statusCode: filesResponse.status,
        body: JSON.stringify({ error: 'Error fetching file list from GitHub' })
      };
    }

    const files = await filesResponse.json();
    
    // Step 2: Count the number of JSON files
    const jsonFiles = files.filter(file => file.name.endsWith('.json'));
    const fileCount = jsonFiles.length;

    // Step 3: Generate the new file name
    const newFileNumber = fileCount + 1;
    const paddedFileNumber = String(newFileNumber).padStart(6, '0');
    const fileName = `Page_${paddedFileNumber}.json`;

    // Step 4: Commit the new file to the GitHub repository
    const commitUrl = `${githubUrl}/${fileName}`;

    const commitResponse = await fetch(commitUrl, {
      method: 'PUT',
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: `Add JSON file: ${fileName}`,
        content: Buffer.from(content).toString('base64'),
        branch
      })
    });

    if (!commitResponse.ok) {
      return {
        statusCode: commitResponse.status,
        body: JSON.stringify({ error: 'Error committing file to GitHub' })
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: `File committed as ${fileName}` })
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'An unexpected error occurred' })
    };
  }
};
