# TridOS app catalog

These are the apps people have shared with everyone who has TridOS. Open **App Distributor → Catalog** in TridOS to browse
and install them: you read an app's source before anything is installed.

Each app is one file, `<name>.tridapp` (the app and a checksum as one line of text starting `TRIDAPP1.`).

## Adding your app

Make it in **Code Studio**, then **App Distributor → Share → Publish to catalog**. That uses the `gh` command (sign in with
`gh auth login`): if you can edit this repo your app goes straight in; otherwise it is sent as a **pull request**, and the
owner reads the app's code before merging it. Apps that use `require`, `process`, `eval`, the network, files or the TridOS
internals are refused by TridOS, and are refused here too.

You can also send the file by hand: save it with *Save file*, put it in this folder and open a pull request.

An app is code that runs on people's computers. Do not merge or install one you have not read.
