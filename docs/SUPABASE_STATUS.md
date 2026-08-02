# Supabase release hosting

Project ID: `igihzeyfgwhnuiflamvn`

wFileManager uses Supabase only to distribute verified release assets. Application accounts,
sessions, roles, settings, notifications and filesystem data are created and managed locally by the
installed application.

The retained wFileManager resources are:

- the public `releases.kmerhosting.com` Storage bucket;
- the `wfilemanager/` release prefix;
- `wfilemanager_release_publish_tokens` for short-lived publisher authorization;
- the `wfilemanager-release-publisher` Edge Function.

No installed application sends runtime data to Supabase.
