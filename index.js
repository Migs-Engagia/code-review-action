const core = require('@actions/core');
const github = require('@actions/github');

async function callClaude(apiKey, content) {
  const body = {
    model: "claude-3-opus-20240229",
    messages: [
      {
        role: "user",
        content: content
      }
    ],
    max_tokens: 1024
  };

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`Claude API request failed: ${response.status} ${await response.text()}`);
  }

  const result = await response.json();
  return result.content[0]?.text ?? "(No response)";
}

async function run() {
  try {
    const token = process.env.GITHUB_TOKEN;
    const apiKey = core.getInput("anthropic-api-key");
    const octokit = github.getOctokit(token);
    const context = github.context;

    if (context.eventName !== "pull_request") {
      core.setFailed("This action only runs on pull_request events.");
      return;
    }

    const { owner, repo } = context.repo;
    const pull_number = context.payload.pull_request.number;
    const base = context.payload.pull_request.base.sha;
    const head = context.payload.pull_request.head.sha;

    // Get the diff between base and head
    const { data: diff } = await octokit.request("GET /repos/{owner}/{repo}/compare/{base}...{head}", {
      owner,
      repo,
      base,
      head,
      headers: {
        accept: "application/vnd.github.v3.diff"
      }
    });

    const prompt = `You are a senior software engineer. Please review the following code diff and give concise suggestions:\n\n${diff}`;

    const claudeResponse = await callClaude(apiKey, prompt);

    // Post the response as a comment
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: pull_number,
      body: `🧠 **Claude Review**\n\n${claudeResponse}`
    });

    core.info("Claude review comment posted!");
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
