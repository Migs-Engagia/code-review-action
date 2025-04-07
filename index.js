const core = require('@actions/core');
const github = require('@actions/github');
const { execSync } = require('child_process');
const fetch = require('node-fetch');

(async () => {
  try {
    const apiKey = core.getInput('anthropic-api-key');
    const { payload } = github.context;

    const base = payload.pull_request.base.ref;
    const target = payload.pull_request.head.ref;

    core.info(`Detected PR: base=${base}, target=${target}`);

    execSync(`git fetch origin ${base}`);
    execSync(`git fetch origin ${target}`);
    execSync(`git checkout ${target}`);

    const diff = execSync(`git diff origin/${base}..origin/${target}`).toString();

    core.info("Generated diff successfully.");

    const claudeSystemPrompt = `
You are Claude, a professional senior software engineer and code reviewer. 
Your job is to:
- Review the code diff below
- Identify potential issues, bugs, improvements or possible security issues
- Keep it concise, constructive, and in markdown format
`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: "claude-3-opus-20240229", // or use claude-3-sonnet for lower cost
        max_tokens: 2048,
        temperature: 0.2,
        system: claudeSystemPrompt,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Here is a git diff from a pull request. Please review it:\n\n${diff}`
              }
            ]
          }
        ]
      })
    });

    const data = await response.json();

    if (data.content && data.content.length > 0) {
      const review = data.content[0].text;
      console.log("Claude Review:\n", review);

      // Use GitHub API to add a comment
      const octokit = github.getOctokit(process.env.GITHUB_TOKEN);
      
      await octokit.rest.issues.createComment({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        issue_number: payload.pull_request.number,
        body: `### Code Review from Claude:\n\n${review}`
      });

      core.info("Added review as a comment to the PR.");
    } else {
      core.setFailed("No response received from Claude.");
      console.error(data);
    }

  } catch (err) {
    core.setFailed(err.message);
    console.error(err);
  }
})();
