const core = require('@actions/core');
const github = require('@actions/github');
const fetch = require('node-fetch');

async function callChatGPT(apiKey, content) {
  const fetch = (await import('node-fetch')).default;
  const body = {
    model: "gpt-4o-mini",  // Use gpt-3.5 if you want a less expensive option
    messages: [
      {
        role: "user",
        content: content
      }
    ],
    max_tokens: 1024
  };

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`ChatGPT API request failed: ${response.status} ${await response.text()}`);
  }

  const result = await response.json();
  return result.choices[0]?.message?.content ?? "(No response)";
}

async function run() {
  try {
    const token = process.env.GITHUB_TOKEN;
    const apiKey = core.getInput("chatgpt-api-key");
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

     // Get list of changed files
     const { data: compare } = await octokit.rest.repos.compareCommits({
      owner,
      repo,
      base,
      head
    });

    const changedFiles = compare.files.map(file => file.filename);

    // Define excluded paths
    const excludedPaths = [
      "README.md",
      ".github/",
    ];

    const isExcluded = (file) =>
      excludedPaths.some(excluded =>
        file === excluded || file.startsWith(excluded)
      );

    const filteredFiles = changedFiles.filter(file => !isExcluded(file));

    if (filteredFiles.length === 0) {
      core.info("All changed files are excluded. Skipping ChatGPT review.");

      await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: pull_number,
        body: `✅ **No code review needed**\n\nAll changed files are in excluded paths, so no review was performed.`
      });

      return;
    }

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

    const prompt = `You are a senior software engineer reviewing a code diff.
            Please analyze the following diff and provide clear, constructive feedback, including suggestions for improvements, best practices, and potential issues.

            Diff:
            ${diff}

            After your review, include:
            1. A summary judgment: **Pass** (no major issues) or **Fail** (requires changes)
            2. A list of all affected files that contain issues.`;

    const chatGPTResponse = await callChatGPT(apiKey, prompt);

    // Post the response as a comment
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: pull_number,
      body: `🧠 **ChatGPT Code Review**\n\n${chatGPTResponse}`
    });

    core.info("ChatGPT review comment posted!");
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
