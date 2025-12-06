import { PlaylistedTrack, Scopes, SpotifyApi, Track } from "@spotify/web-api-ts-sdk";
import { useRef, useState, useEffect } from "react";
import dayjs from 'dayjs'
import { Document, Image, Page as PDFPage, PDFViewer, Text, View } from "@react-pdf/renderer";
import * as QRCode from 'qrcode';

const clientId = import.meta.env.VITE_SPOTIFY_CLIENT_ID as string;
const redirectUri = import.meta.env.VITE_SPOTIFY_REDIRECT_URI as string;

const playlistRegex = /^https:\/\/open\.spotify\.com\/playlist\/([a-zA-Z0-9-]+).*$/gm
const trackUrlRegex = /^(https:\/\/open\.spotify\.com\/(episode|track)\/[a-zA-Z0-9-]+).*$/

const arrayChunks = (array: PlaylistedTrack<Track>[], chunkSize: number) => Array(Math.ceil(array.length / chunkSize))
    .fill(null)
    .map((_, index) => index * chunkSize)
    .map(begin => array.slice(begin, begin + chunkSize));

type OverrideItem = {
    link: string;
    date: string;
    artist: string;
    name: string;
};

type Overrides = Record<string, OverrideItem>;

/* Override example
[
  {
    "link": "https://open.spotify.com/track/a1B2c3D4e5F5g6H7i8j9?si=irrelevantstring",
    "date": "2004",
    "artist": "art",
    "name": "hurra"
  },
  {
    "link": "https://open.spotify.com/track/a1B2c3D4e5F5g6H7i8j9?si=irrelevantstring",
    "date": "2004",
    "artist": "art",
    "name": "hurra"
  }
]
*/

const generateSessionPDFQrCode = async (
    data: string,
): Promise<string> => {
    return QRCode.toDataURL(
        data,
        {
            errorCorrectionLevel: "H",
        },
    );
}

const stripRemasteredTracks = (items: PlaylistedTrack<Track>[]): PlaylistedTrack<Track>[] => {
    return items.map(item => {
        let track = item.track;
        let name = track.name;
        
        // Remove lines with only years
        name = name.split('\n').filter(line => !/^\d{4}$/.test(line.trim())).join(' ');
        
        // Remove anything after " - " that contains remaster, stereo mix, version, or original (case insensitive)
        name = name.replace(/ - (?:.*?)(remaster|remastered|stereo mix|version|original).*$/i, '');
        
        // Remove remaster/version variations in parentheses
        name = name.replace(/\s*\(.*?(remaster|remastered|stereo mix|version).*?\)/i, '');
        
        // Clean up any trailing hyphens and extra whitespace
        name = name.trim().replace(/\s*-\s*$/, '').trim();
        
        return {
            ...item,
            track: {
                ...track,
                name: name
            }
        };
    });
}

function App() {
    const [url, setUrl] = useState<string>('');
    const [playlistItems, setPlaylistItems] = useState<PlaylistedTrack<Track>[] | null>(null);
    const [originalPlaylistItems, setOriginalPlaylistItems] = useState<PlaylistedTrack<Track>[] | null>(null);
    const [name, setName] = useState<string>('');
    const [codeType, setCodeType] = useState('qr');
    const inputRef = useRef<HTMLInputElement>(null);
    const sdk = SpotifyApi.withUserAuthorization(clientId, redirectUri, Scopes.playlistRead);
    const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
    const [overrideJsonErrorMessage, setOverrideJsonErrorMessage] = useState('');
    const overrideJsonRef = useRef<{ value: any } | null >({value: ""});
    const [overrideText, setOverrideText] = useState<string>('');
    const [stripRemastered, setStripRemastered] = useState<boolean>(false);

    // Re-process playlist items when stripRemastered flag changes
    useEffect(() => {
        if (originalPlaylistItems) {
            if (stripRemastered) {
                const stripped = stripRemasteredTracks(originalPlaylistItems);
                setPlaylistItems(stripped);
            } else {
                setPlaylistItems(originalPlaylistItems);
            }
        }
    }, [stripRemastered, originalPlaylistItems]);

    const handleOverrideChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
        const input = event.target.value;
        try {
            if (overrideJsonRef.current !== null) {
                overrideJsonRef.current.value = JSON.parse(input);
            }
            setOverrideJsonErrorMessage('');
        } catch (e) {
            setOverrideJsonErrorMessage('Invalid JSON!');
        }
        setOverrideText(input);
    };

    const getPlaylist = async () => {
        const match = playlistRegex.exec(url);
        if (!match) {
            return;
        }

        const items: PlaylistedTrack<Track>[] = [];
        const limit = 50;
        let result = null;
        let offset = 0;

        do {
            result = await sdk.playlists.getPlaylistItems(match[1], 'DE', 'offset,limit,next,items(track(id,name,artists(name),album(release_date),type,external_urls),added_at)', limit, offset);
            const filteredItems = result.items.filter(item => item.track?.name);
            items.push(...filteredItems);
            offset += result.limit;
        } while (result.next !== null);

        // construct override object indexed by track links
        // we need this to strip any possible &si= parts in the url
        let overrides : Overrides = {}
        let overrideJson : OverrideItem[] = [];
        if (overrideJsonRef.current !== null) {
            overrideJson = overrideJsonRef.current.value
        }
        for (var index in overrideJson) {
            let item = overrideJson[index];
            let match = trackUrlRegex.exec(item.link);
            // If track has no further url parts, just use the track url as-is
            // else use the first part of the url
            if (!match) {
                overrides[item.link] = item;
            } else {
                overrides[match[1]] = item;
            }
        }
        // apply overrides
        for (var index in items) {
            let track = items[index].track;
            let override = overrides[track.external_urls.spotify]
            if (override) {
                if (override.name) items[index].track.name = override.name;
                if (override.artist) items[index].track.artists = [{
                    ...items[index].track.artists[0],
                    "name": override.artist
                }]
                if (override.date) items[index].track.album.release_date = override.date;
            }
        }
        // Store original items
        setOriginalPlaylistItems(items);
        
        // Apply stripping if enabled
        if (stripRemastered) {
            const stripped = stripRemasteredTracks(items);
            setPlaylistItems(stripped);
        } else {
            setPlaylistItems(items);
        }
    }

    const setCardName = () => {
        setName(inputRef.current?.value ?? '');
    }

    return (
        <div className="w-full h-screen overflow-scroll">
            <div className="mx-auto mt-16 w-full mt-8 px-8">

                <div className="pointer-events-auto flex items-center justify-between gap-x-6 bg-blue-50 px-6 py-2.5 sm:rounded-xl sm:py-3 sm:pl-4 sm:pr-3.5 mb-4 sm:mb-8">
                    <div className="text-sm leading-6 text-blue-700 flex space-x-2">
                        <div className="text-blue-400">
                            <strong className="font-semibold">Important</strong>
                            <svg viewBox="0 0 2 2" className="mx-2 inline h-0.5 w-0.5 fill-current" aria-hidden="true">
                                <circle cx={1} cy={1} r={1}/>
                            </svg>
                            <span>
                                This tool uses the Spotify API to read the release year of the tracks by looking at the tracks album release year.
When creating your playlist you need to pay attention to select the original tracks and not the remastered versions or version of the tracks that are part of some compilations since this results in wrong release year information.
                            </span>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-5">

                    <div className="col-span-1 sm:col-span-4">
                        <label htmlFor="playlist" className="block text-sm font-semibold leading-6 text-gray-900">
                            Playlist URL
                        </label>
                        <div className="mt-2.5">
                            <input
                                type="text"
                                id="playlist"
                                value={url}
                                placeholder="https://open.spotify.com/playlist/A1B2C3D4E5F6G7H8I9"
                                onChange={e => setUrl(e.target.value)}
                                className="block w-full rounded-md border-0 px-3.5 py-2 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
                            />
                        </div>
                    </div>
                    <div className="flex items-end">
                        <button
                            onClick={getPlaylist}
                            className="block w-full rounded-md bg-indigo-600 px-3.5 py-2.5 text-center text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
                        >
                            Load Playlist Data
                        </button>

                    </div>
                </div>

                <div className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-5 mt-4">
                    <div className="col-span-1 sm:col-span-4">
                        <label htmlFor="name" className="block text-sm font-semibold leading-6 text-gray-900">
                            Name (optional, will be printed on the cards)
                        </label>
                        <div className="mt-2.5">
                            <input
                                type="text"
                                id="name"
                                ref={inputRef}
                                className="block w-full rounded-md border-0 px-3.5 py-2 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
                            />
                        </div>
                    </div>
                    <div className="flex items-end">
                        <button
                            onClick={() => setCardName()}
                            className="block w-full rounded-md bg-indigo-600 px-3.5 py-2.5 text-center text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
                        >
                            Set Name
                        </button>
                    </div>
                </div>
                <div className="mt-4">
                    <button onClick={() => setShowAdvancedOptions(!showAdvancedOptions)}
                            className="block rounded-md bg-indigo-600 px-3.5 py-2.5 text-center text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600">
                        {showAdvancedOptions ? 'Hide Advanced Options' : 'Show Advanced Options'}
                    </button>
                    {showAdvancedOptions && (
                    <div>
                        <div className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-8 mt-4">
                            <div className="col-span-1 sm:col-span-1">
                                <label htmlFor="codeType" className="block text-sm font-semibold leading-6 text-gray-900">
                                    Select Code Type
                                </label>
                                <div className="mt-2.5">
                                    <select
                                        id="codeType"
                                        name="codeType"
                                        className="block w-full rounded-md border-0 px-3.5 py-2 shadow-sm ring-1 ring-inset focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
                                        onChange={e => setCodeType(e.target.value)}
                                    >
                                        <option value="qr">QR Code</option>
                                        <option value="spotify">Spotify Code</option>
                                    </select>
                                </div>
                            </div>
                            <div className="col-span-1 sm:col-span-1">
                                <label htmlFor="stripRemastered" className="block text-sm font-semibold leading-6 text-gray-900">
                                    Strip common "Remastered" elements in song titles
                                </label>
                                <div className="mt-2.5">
                                    <input
                                        type="checkbox"
                                        id="stripRemastered"
                                        name="stripRemastered"
                                        checked={stripRemastered}
                                        className="h-4 w-4 rounded-md border-0 px-3.5 py-2"
                                        onChange={e => setStripRemastered(e.target.checked)}
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="col-span-1 sm:col-span-4">
                            <label htmlFor="overrideText" className="block mt-2.5 text-sm font-semibold leading-6 text-gray-900">
                                Overrides
                            </label>
                            <div className="mt-2.5">
                                <textarea
                                    id="overrideText"
                                    value={overrideText}
                                    onChange={handleOverrideChange}
                                    rows={6} // You can adjust the number of rows as needed
                                    placeholder={`[{
    "link": "https://open.spotify.com/track/a1B2c3D4e5F5g6H7i8j9?si=irrelevantstring",
    "date": "2004",
    "artist": "art",
    "name": "hurra"
  }]`}
                                className="block w-full rounded-md border-0 px-3.5 py-2 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
                            />
                            </div>
                           {overrideJsonErrorMessage && <div style={{ color: 'red' }}>{overrideJsonErrorMessage}</div>}
                        </div>
                    </div>
                )}
                </div>
            </div>

            {
                playlistItems && (
                    <PDFViewer className="w-3/4 h-3/4 mx-auto mt-8">
                        <Document>
                            {arrayChunks(playlistItems, 12).map((pageChunks, pageIndex) => (
                                <>
                                    <PDFPage size="A4" key={`page-${pageIndex}`} style={{
                                        display: 'flex',
                                        flexDirection: 'row',
                                        flexWrap: 'wrap',
                                        justifyContent: 'space-between',
                                        padding: '30px'
                                    }}>
                                        <View style={{
                                            display: "flex",
                                            flexDirection: "row",
                                            height: "0.1cm"
                                        }}>
                                            <View style={{
                                                width: "0.1cm",
                                                height: "0.1cm",
                                                borderBottom: "1px solid #000",
                                                borderRight: "1px solid #000"
                                            }}></View>
                                            <View style={{
                                                width: "6.1cm",
                                                borderRight: "1px solid #000"
                                            }}>
                                            </View>
                                            <View style={{width: "6.2cm"}}></View>
                                            <View style={{
                                                width: "6.1cm",
                                                borderLeft: "1px solid #000",
                                            }}></View>
                                            <View style={{
                                                width: "0.1cm",
                                                height: "0.1cm",
                                                borderBottom: "1px solid #000",
                                                borderLeft: "1px solid #000"
                                            }}></View>
                                        </View>
                                        {arrayChunks(pageChunks, 3).map((rowChunk, rowIndex) => (
                                            <View>
                                                <View key={`row-${rowIndex}`}
                                                      style={{
                                                          display: "flex",
                                                          flexDirection: "row",
                                                      }}>
                                                    {rowChunk.map(item => (
                                                        <View key={item.track.id}
                                                              style={{
                                                                  //border: '1px solid #000',
                                                                  width: '6.2cm',
                                                                  height: '6.2cm',
                                                                  textAlign: 'center',
                                                                  display: 'flex',
                                                                  justifyContent: 'center',
                                                                  padding: '10px'
                                                              }}>
                                                            <Text style={{
                                                                fontSize: '0.5cm',
                                                            }}>
                                                                {item.track.name}
                                                            </Text>
                                                            <Text style={{
                                                                fontWeight: 900,
                                                                fontSize: '1.5cm',
                                                                marginTop: '10px',
                                                                marginBottom: '10px'
                                                            }}>
                                                                {dayjs(item.track.album.release_date).format('YYYY')}
                                                            </Text>
                                                            <Text style={{
                                                                fontSize: '0.5cm',
                                                            }}>
                                                                {item.track.artists.map(artist => artist.name).join(', ')}
                                                            </Text>
                                                            {name && (
                                                                <Text style={{
                                                                    fontSize: '0.2cm',
                                                                    marginTop: '20px',
                                                                }}>
                                                                    {name}
                                                                </Text>
                                                            )}
                                                        </View>
                                                    ))}
                                                </View>
                                                <View style={{
                                                    display: "flex",
                                                    flexDirection: "row",
                                                    height: "0.1cm"
                                                }}>
                                                    <View style={{
                                                        width: "0.1cm",
                                                        height: "0.1cm",
                                                        borderBottom: "1px solid #000",
                                                    }}></View>
                                                    <View style={{
                                                        width: "6.1cm",
                                                        borderRight: rowIndex !== 3 ? "1px solid #000": undefined
                                                    }}>
                                                    </View>
                                                    <View style={{width: "6.2cm"}}></View>
                                                    <View style={{
                                                        width: "6.1cm",
                                                        borderLeft: rowIndex !== 3 ? "1px solid #000": undefined,
                                                    }}></View>
                                                    <View style={{
                                                        width: "0.1cm",
                                                        height: "0.1cm",
                                                        borderBottom: "1px solid #000",
                                                    }}></View>
                                                </View>
                                            </View>
                                        ))}
                                        <View style={{
                                            display: "flex",
                                            flexDirection: "row",
                                            height: "0.1cm"
                                        }}>
                                            <View style={{
                                                width: "0.1cm",
                                                height: "0.1cm",
                                                borderRight: "1px solid #000"
                                            }}></View>
                                            <View style={{
                                                width: "6.1cm",
                                                borderRight: "1px solid #000"
                                            }}>
                                            </View>
                                            <View style={{width: "6.2cm"}}></View>
                                            <View style={{
                                                width: "6.1cm",
                                                borderLeft: "1px solid #000",
                                            }}></View>
                                            <View style={{
                                                width: "0.1cm",
                                                height: "0.1cm",
                                                borderLeft: "1px solid #000"
                                            }}></View>
                                        </View>
                                    </PDFPage>
                                    <PDFPage size="A4" key={`page-${pageIndex}`} style={{
                                        display: 'flex',
                                        flexDirection: 'row',
                                        flexWrap: 'wrap',
                                        justifyContent: 'space-between',
                                        padding: '30px'
                                    }}>
                                        <View style={{
                                            display: "flex",
                                            flexDirection: "row",
                                            height: "0.1cm"
                                        }}>
                                            <View style={{
                                                width: "0.1cm",
                                                height: "0.1cm",
                                                borderBottom: "1px solid #000",
                                                borderRight: "1px solid #000"
                                            }}></View>
                                            <View style={{
                                                width: "6.1cm",
                                                borderRight: "1px solid #000"
                                            }}>
                                            </View>
                                            <View style={{width: "6.2cm"}}></View>
                                            <View style={{
                                                width: "6.1cm",
                                                borderLeft: "1px solid #000",
                                            }}></View>
                                            <View style={{
                                                width: "0.1cm",
                                                height: "0.1cm",
                                                borderBottom: "1px solid #000",
                                                borderLeft: "1px solid #000"
                                            }}></View>
                                        </View>
                                        {arrayChunks(pageChunks, 3).map((rowChunk, rowIndex) => (
                                            <View>
                                                <View key={`row-${rowIndex}`}
                                                      style={{
                                                          display: "flex",
                                                          flexDirection: "row-reverse",
                                                      }}>
                                                    {rowChunk.map(item => (
                                                        <>
                                                            {codeType === 'qr' ? (
                                                                <View key={item.track.id}
                                                                      style={{
                                                                          //border: '1px solid #000',
                                                                          width: '6.2cm',
                                                                          height: '6.2cm',
                                                                          textAlign: 'center',
                                                                          display: 'flex',
                                                                          justifyContent: 'center',
                                                                          padding: '10px'
                                                                      }}>
                                                                    <Image src={generateSessionPDFQrCode(`spotify:track:${item.track.id}`)}
                                                                           style={{width: '4cm', margin: '0 auto'}}/>
                                                                </View>
                                                            ) : (
                                                                <View key={item.track.id}
                                                                      style={{
                                                                          //border: '1px solid #000',
                                                                          width: '6.2cm',
                                                                          height: '6.2cm',
                                                                          textAlign: 'center',
                                                                          display: 'flex',
                                                                          justifyContent: 'center',
                                                                          padding: '10px'
                                                                      }}>
                                                                    <Image src={`https://scannables.scdn.co/uri/plain/jpeg/FFFFFF/black/320/spotify:track:` + item.track.id}
                                                                           style={{width: '4cm', margin: '0 auto'}}/>
                                                                </View>
                                                            )}
                                                        </>

                                                    ))}
                                                </View>
                                                <View style={{
                                                    display: "flex",
                                                    flexDirection: "row",
                                                    height: "0.1cm"
                                                }}>
                                                    <View style={{
                                                        width: "0.1cm",
                                                        height: "0.1cm",
                                                        borderBottom: "1px solid #000",
                                                    }}></View>
                                                    <View style={{
                                                        width: "6.1cm",
                                                        borderRight: rowIndex !== 3 ? "1px solid #000": undefined
                                                    }}>
                                                    </View>
                                                    <View style={{width: "6.2cm"}}></View>
                                                    <View style={{
                                                        width: "6.1cm",
                                                        borderLeft: rowIndex !== 3 ? "1px solid #000": undefined,
                                                    }}></View>
                                                    <View style={{
                                                        width: "0.1cm",
                                                        height: "0.1cm",
                                                        borderBottom: "1px solid #000",
                                                    }}></View>
                                                </View>
                                            </View>
                                        ))}
                                        <View style={{
                                            display: "flex",
                                            flexDirection: "row",
                                            height: "0.1cm"
                                        }}>
                                            <View style={{
                                                width: "0.1cm",
                                                height: "0.1cm",
                                                borderRight: "1px solid #000"
                                            }}></View>
                                            <View style={{
                                                width: "6.1cm",
                                                borderRight: "1px solid #000"
                                            }}>
                                            </View>
                                            <View style={{width: "6.2cm"}}></View>
                                            <View style={{
                                                width: "6.1cm",
                                                borderLeft: "1px solid #000",
                                            }}></View>
                                            <View style={{
                                                width: "0.1cm",
                                                height: "0.1cm",
                                                borderLeft: "1px solid #000"
                                            }}></View>
                                        </View>
                                    </PDFPage>
                                </>
                            ))}
                        </Document>
                    </PDFViewer>
                )}
        </div>
    )
}

export default App;
