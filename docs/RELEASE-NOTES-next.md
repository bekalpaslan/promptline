### Updates

- **An update has to be signed for the version it claims.** Promptline now refuses an update whose signature doesn't name the version on offer, so a tampered feed can't pass an older build off as a newer one. The app sends nothing new over the network.
- **Updates download a copy of the installer made for them.** It has its own name on the release page, so GitHub's download counter shows how many copies took an update. The app still sends nothing about you: it's the same request to the same place, under a different file name.
