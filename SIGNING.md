# Windows code signing

The Windows installer and the portable executable are signed through
[SignPath Foundation](https://signpath.org), which provides free certificates to open-source projects.
The release workflow (`.github/workflows/release.yml`) is already wired for it. It stays inactive until
the repository variable `SIGNPATH_ORGANIZATION_ID` exists, so builds keep working unsigned before that.

## One-time setup (done by the repository owner)

1. Apply at <https://signpath.org/apply> with the repository URL. The project must be public, under an
   OSI license (MIT here), already released and maintained. Approval is manual and can take days or weeks.
2. In SignPath, create the organization and a project with the slug `smith-chart`.
3. Add the predefined "GitHub.com" trusted build system to the organization and link it to the project.
4. In the project, add the artifact configuration from `.signpath/artifact-configuration.xml` (set it as
   the default).
5. Create a signing policy with the slug `release-signing` and the certificate granted by the Foundation.
   Release signing requires a manual approval in SignPath for each release.
6. Create a user with submitter rights on that policy and generate its API token.
7. In the GitHub repository settings (Secrets and variables, Actions):
   - secret `SIGNPATH_API_TOKEN`: the token of step 6;
   - variable `SIGNPATH_ORGANIZATION_ID`: the organization ID shown in SignPath.
   - Optional variables `SIGNPATH_PROJECT_SLUG` and `SIGNPATH_SIGNING_POLICY_SLUG` if the slugs differ.
8. Push a version tag. The Windows job uploads the unsigned files, waits for the signing request
   (up to 3 hours: approve it in SignPath), then uploads the signed files to the release.

## Text required by SignPath Foundation

Once approved, put this section in the README and keep it on the release pages:

> ### Code signing policy
>
> Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by
> [SignPath Foundation](https://signpath.org).
>
> - Committers, reviewers and approvers: [blatti-thomas](https://github.com/blatti-thomas)
> - Privacy: this program does not send any information to other networked systems.

Then remove the sentence about unsigned builds from the README.

## What to expect

A signature removes the "unknown publisher" warning. Windows SmartScreen also judges the reputation of the
certificate and of the file. A SignPath Foundation certificate is shared by several projects, so the
reputation usually builds up quickly, but a warning can remain on the first downloads of a new release.
